/**
 * Local API server — the self-hosted stand-in for Base44's backend.
 *
 * Serves everything the site asks of its backend:
 *   /api/entities/*      CRUD over the JSON store
 *   /api/events          Server-Sent Events, so entity.subscribe() still works
 *   /api/auth/*          local accounts (see auth.js)
 *   /api/functions/*     the Base44 edge functions, run unmodified (denoAdapter)
 *   /api/integrations/*  InvokeLLM / SendEmail
 *   /api/upload          file uploads (integrations.Core.UploadFile)
 *   /api/logs/page-view  the page-view breadcrumb NavigationTracker sends
 *
 * In production it also serves the built frontend from ./dist, so the whole
 * site is one `npm start` on one port.
 */
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import db, { isValidEntityName } from './db.js';
import { setFunctionInvoker } from './base44Server.js';
import { authRouter, ensureAdminAccount, userFromRequest } from './auth.js';
import { invokeLLM, sendEmail } from './integrations.js';
import { loadEdgeFunctions, runEdgeFunction } from './denoAdapter.js';
import { createBackup, listBackups, formatBytes } from './backup.js';
import getMetOfficeWarnings, { slotStart, nextSlot } from './functions/getMetOfficeWarnings.js';
import getMetOfficeLocationWeather from './functions/getMetOfficeLocationWeather.js';
import ukCityConditions from './ukCityConditions.js';
import worldWarnings, { worldWarningDetail } from './worldWarnings.js';
import radarPhase from './radarPhase.js';
import { mountTcmV5 } from './tcmV5.js';
import { startAiw } from './aiw/index.js';
import { mountScenarios } from './scenarios/api.js';
import { startLiveScenarios } from './scenarios/live/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const UPLOAD_DIR = path.join(here, 'uploads');
const PORT = Number(process.env.API_PORT || 8787);
const IS_PROD = process.env.NODE_ENV === 'production';

/** Refresh Met Office warnings on this interval. 0 disables the timer. */
const REFRESH_MINUTES = Number(process.env.WARNINGS_REFRESH_MINUTES ?? 60);

/** Take an automatic backup this often. 0 disables scheduled backups. */
const BACKUP_HOURS = Number(process.env.BACKUP_INTERVAL_HOURS ?? 24);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

/* ── live updates ───────────────────────────────────────────────────────── */

const clients = new Set();

/** Push an entity change to every open SSE connection. */
function broadcast(entity, type, data) {
  const frame = `data: ${JSON.stringify({ entity, type, data })}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  clients.add(res);

  // Keep proxies from closing an idle stream.
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* cleaned up on close */
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

/* ── entities ───────────────────────────────────────────────────────────── */

app.param('entity', (req, res, next, entity) => {
  if (!isValidEntityName(entity)) {
    return res.status(400).json({ error: `Invalid entity name: ${entity}` });
  }
  next();
});

app.get('/api/entities/:entity', (req, res) => {
  let query;
  if (req.query.q) {
    try {
      query = JSON.parse(req.query.q);
    } catch {
      return res.status(400).json({ error: 'q must be JSON' });
    }
  }
  res.json(db.list(req.params.entity, { query, sort: req.query.sort, limit: req.query.limit }));
});

app.post('/api/entities/:entity/bulk', (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [req.body];
  const created = db.bulkCreate(req.params.entity, rows);
  broadcast(req.params.entity, 'create', created);
  res.status(201).json(created);
});

app.get('/api/entities/:entity/:id', (req, res) => {
  const row = db.get(req.params.entity, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.post('/api/entities/:entity', (req, res) => {
  const row = db.create(req.params.entity, req.body || {});
  broadcast(req.params.entity, 'create', row);
  res.status(201).json(row);
});

app.put('/api/entities/:entity/:id', (req, res) => {
  const row = db.update(req.params.entity, req.params.id, req.body || {});
  if (!row) return res.status(404).json({ error: 'Not found' });
  broadcast(req.params.entity, 'update', row);
  res.json(row);
});

app.delete('/api/entities/:entity/:id', (req, res) => {
  const ok = db.remove(req.params.entity, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  broadcast(req.params.entity, 'delete', { id: req.params.id });
  res.status(204).end();
});

/* ── auth ───────────────────────────────────────────────────────────────── */

app.use('/api/auth', authRouter());

/* ── integrations ───────────────────────────────────────────────────────── */

/** Wrap a promise-returning handler so a rejection becomes a clean JSON error. */
function jsonRoute(handler) {
  return async (req, res) => {
    try {
      res.json(await handler(req));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  };
}

app.post(
  '/api/integrations/invoke-llm',
  jsonRoute((req) => invokeLLM(req.body || {}))
);
app.post(
  '/api/integrations/send-email',
  jsonRoute((req) => sendEmail(req.body || {}))
);

/* ── page-view log ──────────────────────────────────────────────────────── */

app.post('/api/logs/page-view', (req, res) => {
  const user = userFromRequest(req);
  db.logPageView({
    page: req.body?.page || null,
    at: req.body?.at || new Date().toISOString(),
    user: user?.email || null,
  });
  res.status(204).end();
});

/* ── functions ──────────────────────────────────────────────────────────── */

/**
 * The Base44 edge functions run unmodified through denoAdapter. Two of them
 * are overridden here:
 *
 *  getMetOfficeWarnings — the original asks an LLM to turn the Met Office page
 *    into JSON, which needs a key and can invent a warning. The local port
 *    parses the same page deterministically. Set USE_ORIGINAL_WARNINGS=true to
 *    run the export's version instead.
 */
const edge = { handlers: {}, failures: [] };

const OVERRIDES = {
  async getMetOfficeWarnings() {
    const result = await getMetOfficeWarnings(db);
    const record = db.list('CachedWarnings')[0];
    if (record) broadcast('CachedWarnings', 'update', record);
    return result;
  },

  /*  getMetOfficeLocationWeather — the original needs a paid Met Office
   *  DataHub key. This one gets the same Met Office model data from Open-Meteo
   *  without a key. */
  getMetOfficeLocationWeather: (payload) => getMetOfficeLocationWeather(payload),
};

/** Env switches that hand a name back to the Base44 original. */
const USE_ORIGINAL = {
  getMetOfficeWarnings: 'USE_ORIGINAL_WARNINGS',
  getMetOfficeLocationWeather: 'USE_ORIGINAL_LOCATION_WEATHER',
};

function overridden(name) {
  const flag = USE_ORIGINAL[name];
  if (flag && process.env[flag] === 'true') return null;
  return OVERRIDES[name] || null;
}

/* The permanent warnings archive, for the day-by-day history panel.
 *
 * Returns every warning ever recorded plus a day index, because the panel
 * needs both: a calendar coloured by the worst warning on each day, and the
 * warnings themselves once a day is opened. The archive is written by
 * getMetOfficeWarnings on every refresh and nothing deletes from it.
 *
 * `ARCHIVE_EPOCH` is the first day the calendar offers. Earlier days are not
 * missing data, they are days that predate the archive existing at all — the
 * panel says so rather than showing empty squares that imply "no warnings". */
const ARCHIVE_EPOCH = '2026-01-01';

app.get('/api/warning-archive', (req, res) => {
  try {
    const sev = (s) => (s === 'red' ? 3 : s === 'amber' ? 2 : 1);

    /* Every UK calendar day a period covers, as YYYY-MM-DD. Same rule the
       archiver uses, so a manual warning and a Met Office one land on the same
       days. */
    const daysBetween = (from, to) => {
      const a = new Date(from);
      if (Number.isNaN(a.getTime())) return [];
      const b = new Date(to || from);
      const end = Number.isNaN(b.getTime()) ? a : b;
      const fmt = (d) => new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(d);
      const out = [];
      const cur = new Date(a);
      for (let i = 0; i <= 40 && cur <= end; i += 1) {
        out.push(fmt(cur));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      const last = fmt(end);
      if (!out.includes(last)) out.push(last);
      return out;
    };

    /* MANUALLY ISSUED WARNINGS COUNT AS HISTORY TOO, and they are the only
       history this site has that predates the archive. They also carry the
       drawn area, which is what lets the panel show how a warning actually
       looked on the map rather than just describing it. Normalised into the
       same shape as an archived one so the panel has a single list to render. */
    const manual = (db.list('ManualWarning') || [])
      .filter((m) => m.is_published !== false && m.status !== 'draft' && m.valid_from)
      .map((m) => ({
        id: `manual:${m.id}`,
        warning_key: `manual|${m.id}`,
        type: m.type || 'Unknown',
        severity: String(m.severity || 'yellow').toLowerCase(),
        regions: Array.isArray(m.areas) ? m.areas : [],
        description: m.description || m.title || '',
        headline: m.title || '',
        impacts: '',
        valid_from: m.valid_from,
        valid_to: m.valid_to || null,
        area_drawing: m.area_drawing || null,
        days: daysBetween(m.valid_from, m.valid_to),
        first_seen: m.created_date || m.valid_from,
        last_seen: m.updated_date || m.valid_to || m.valid_from,
        issued_by: 'manual',
      }));

    const rows = [...(db.list('WarningArchive') || []), ...manual];

    const days = {};
    const totals = { yellow: 0, amber: 0, red: 0 };
    const byType = {};

    for (const r of rows) {
      const severity = r.severity === 'red' || r.severity === 'amber' ? r.severity : 'yellow';
      totals[severity] += 1;
      const t = r.type || 'Unknown';
      byType[t] = byType[t] || { yellow: 0, amber: 0, red: 0, total: 0 };
      byType[t][severity] += 1;
      byType[t].total += 1;

      for (const d of r.days || []) {
        if (d < ARCHIVE_EPOCH) continue;
        const day = days[d] || (days[d] = { top: 'yellow', counts: { yellow: 0, amber: 0, red: 0 }, ids: [] });
        day.counts[severity] += 1;
        day.ids.push(r.id);
        if (sev(severity) > sev(day.top)) day.top = severity;
      }
    }

    res.json({
      epoch: ARCHIVE_EPOCH,
      /* The day the archive genuinely starts holding data, as opposed to the
         day the calendar starts. The panel needs both to be honest about the
         gap between them. */
      recordingSince: rows.reduce(
        (min, r) => (r.first_seen && (!min || r.first_seen < min) ? r.first_seen : min),
        null,
      ),
      totals,
      byType,
      days,
      warnings: rows,
    });
  } catch (err) {
    console.error('[warning-archive]', err);
    res.status(500).json({ error: 'Archive unavailable' });
  }
});

/* Home page UK city cards, from Met Office DataHub rather than Open-Meteo.
   Off unless HOME_CITIES_FROM_DATAHUB=true — see server/ukCityConditions.js for
   why, and what it costs in daily allowance. */
app.post('/api/uk-city-conditions', async (req, res) => {
  try {
    res.json(await ukCityConditions(req.body || {}));
  } catch (err) {
    console.error('[uk-city-conditions]', err);
    // Never fail the card: the page keeps its Open-Meteo values.
    res.json({ enabled: false, results: [] });
  }
});

/* Worldwide severe-weather warnings — the WMO's aggregation of every national
   met service's CAP alerts, with the US National Weather Service's GeoJSON
   folded in for geometry. See server/worldWarnings.js for what it can and
   cannot draw, and why. */
app.get('/api/world-warnings', async (req, res) => {
  try {
    const payload = await worldWarnings();
    res.setHeader('Cache-Control', 'public, max-age=120');
    res.json(payload);
  } catch (err) {
    console.error('[world-warnings]', err);
    res.json({ ok: false, error: 'unavailable', warnings: [], counts: { total: 0, drawn: 0 } });
  }
});

/* One alert's full CAP document, fetched when a warning is opened. */
app.get('/api/world-warnings/cap', async (req, res) => {
  try {
    const payload = await worldWarningDetail(req.query.u);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(payload);
  } catch (err) {
    res.status(err.status === 400 ? 400 : 502).json({ ok: false, error: err.message });
  }
});

app.post('/api/functions/:name', async (req, res) => {
  const { name } = req.params;

  const override = overridden(name);
  if (override) {
    try {
      return res.json(await override(req.body || {}, req));
    } catch (err) {
      console.error(`[functions/${name}]`, err);
      return res.status(500).json({ error: err.message });
    }
  }

  const handler = edge.handlers[name];
  if (!handler) {
    return res.status(404).json({
      error: `Function "${name}" is not available in the self-hosted build.`,
    });
  }

  try {
    await runEdgeFunction(handler, req, res);
  } catch (err) {
    console.error(`[functions/${name}]`, err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

/**
 * Function-to-function calls from inside an edge function (pollBlitzortung
 * chains to itself). Returns the parsed JSON body, matching the SDK.
 */
setFunctionInvoker(async (name, payload = {}) => {
  const override = overridden(name);
  if (override) return override(payload, null);

  const handler = edge.handlers[name];
  if (!handler) throw new Error(`Function "${name}" is not available`);

  const request = new Request(`http://localhost:${PORT}/api/functions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const response = await handler(request);
  return response.json().catch(() => null);
});

/* ── radar precipitation phase ──────────────────────────────────────────────
   A coarse thermal field the radar uses to decide whether an echo is rain,
   sleet, snow or freezing rain. Cached server-side, so every visitor's map
   shares one set of requests upstream. */

app.get('/api/radar/phase', async (req, res) => {
  const field = await radarPhase();
  if (!field) return res.status(503).json({ error: 'phase field unavailable' });
  res.set('Cache-Control', 'public, max-age=300');
  res.json(field);
});

/* ── TCM V5 ─────────────────────────────────────────────────────────────────
   Forecast bundles exported by the V5 platform and copied in under
   server/data/tcm-v5. Read from disk; nothing here talks to the Python
   service. See tcmV5.js. */
mountTcmV5(app);

/* ── uploads ────────────────────────────────────────────────────────────── */

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ file_url: `/uploads/${req.file.filename}` });
});

/* AI lightning warnings: ingestion, nowcast engine and its /api/aiw routes.
   Registered before the SPA fallback below so the routes are reachable. */
startAiw(app);
mountScenarios(app);
startLiveScenarios(app);

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1y' }));

/* ── static frontend (production) ───────────────────────────────────────── */

if (IS_PROD) {
  const dist = path.join(ROOT, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    // Client-side routing: hand any non-API path back to index.html.
    app.get(/^(?!\/(api|uploads)\/).*/, (req, res) =>
      res.sendFile(path.join(dist, 'index.html'))
    );
  } else {
    console.warn('[server] NODE_ENV=production but ./dist is missing — run `npm run build`.');
  }
}

/* ── start ──────────────────────────────────────────────────────────────── */

const loaded = await loadEdgeFunctions();
edge.handlers = loaded.handlers;
edge.failures = loaded.failures;

ensureAdminAccount();

app.listen(PORT, () => {
  console.log(`[server] API on http://localhost:${PORT}/api`);
  if (IS_PROD) console.log(`[server] site on http://localhost:${PORT}`);
  console.log(
    `[server] ${Object.keys(edge.handlers).length} Base44 functions loaded` +
      (edge.failures.length ? `, ${edge.failures.length} failed` : '')
  );
  for (const failure of edge.failures) console.warn(`  ! ${failure}`);

  // Warm the warnings cache on boot, then keep it fresh. Failures are logged
  // and retried on the next tick rather than taking the server down.
  const refresh = () =>
    getMetOfficeWarnings(db)
      .then(() => {
        const rec = db.list('CachedWarnings')[0];
        if (rec) broadcast('CachedWarnings', 'update', rec);
      })
      .catch((err) => console.warn('[server] warnings refresh failed:', err.message));

  /* Warnings refresh on the clock, on a fixed slot — never because a visitor
   * loaded the page. Two consequences worth keeping: every visitor sees the
   * same set, and the countdown on the page means the same thing to all of
   * them. A self-correcting timeout is used rather than setInterval, which
   * drifts and would slowly wander off the slot boundary.
   *
   * The one fetch that is not on the clock is at boot, and only when the cache
   * is missing or already stale — otherwise a cold start would serve nothing
   * until the next boundary. */
  const cached = db.list('CachedWarnings')[0];
  const cachedAt = cached?.fetched_at ? new Date(cached.fetched_at) : null;
  const stale = !cachedAt || cachedAt < slotStart(new Date());
  if (stale) {
    refresh();
  } else {
    console.log(
      `[warnings] cache is current (${cachedAt.toISOString()}) — waiting for the next slot`
    );
  }

  if (REFRESH_MINUTES > 0) {
    const scheduleNext = () => {
      const delay = nextSlot(new Date()) - Date.now();
      setTimeout(() => {
        refresh();
        scheduleNext();
      }, Math.max(1000, delay)).unref?.();
    };
    scheduleNext();
    console.log(`[warnings] next refresh at ${nextSlot(new Date()).toLocaleTimeString('en-GB')}`);
  }

  /* Backups. One on boot, then on a timer — a backup you have to remember to
   * take is one you won't have when you need it. Failures are logged and the
   * site carries on; a missing backup must never take the site down. */
  const backup = (reason) => {
    try {
      const manifest = createBackup({ reason });
      console.log(
        `[backup] ${manifest.name} — ${manifest.database?.totalRows ?? 0} rows, ` +
          `${manifest.uploads.files} upload(s), ${formatBytes(manifest.sizeBytes)}`
      );
    } catch (err) {
      console.warn(`[backup] failed: ${err.message}`);
    }
  };

  backup('startup');
  if (BACKUP_HOURS > 0) {
    setInterval(() => backup('scheduled'), BACKUP_HOURS * 60 * 60 * 1000);
    console.log(`[backup] ${listBackups().length} kept, next in ${BACKUP_HOURS}h`);
  }
});
