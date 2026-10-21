/**
 * AI lightning warning system — wiring into the Express server.
 *
 *   ingest   live lightning (Blitzortung), validated, de-duplicated, archived
 *   engine   the once-a-minute forecasting + warning cycle
 *   api      /api/aiw/* (public + admin)
 *
 * Set AIW_DISABLED=true to run the site without any of it.
 */
import { createIngest } from './ingest.js';
import { createEngine } from './engine.js';
import { createRouter } from './api.js';
import { flushArchive, readStrikes, archiveSummary, getState } from './store.js';
import { compactArchive } from './warnings.js';

const WORKER_URL = 'https://blitzortungworker-3.onrender.com/strikes';

export function startAiw(app) {
  if (process.env.AIW_DISABLED === 'true') { console.log('[aiw] disabled by AIW_DISABLED'); return null; }

  const ingest = createIngest();
  // Restart recovery: the last 75 minutes from our own archive, so storms
  // keep their history (and the archive is not written twice).
  const now = Date.now();
  const history = readStrikes(now - 75 * 60e3, now + 60e3);
  ingest.seed(history);
  ingest.start();

  let broadcast = () => {};
  const engine = createEngine({ ingest, broadcast: (m) => broadcast(m) });
  const api = createRouter({ engine, ingest });
  broadcast = api.broadcast;
  app.use('/api/aiw', api.router);
  engine.start();

  // Backfill whatever the Render relay still holds (≈25–40 min, Europe) so a
  // fresh start has history for motion estimates immediately.
  fetch(WORKER_URL, { signal: AbortSignal.timeout(60000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (!j?.strikes?.length) return;
      const added = ingest.inject(j.strikes.map((s) => ({ time: s.time, lat: s.lat, lon: s.lon, provider: 'blitzortung-relay' })));
      console.log(`[aiw] backfilled ${added.length} strikes from the relay`);
    })
    .catch(() => {});

  // Daily retrain at ~03:30 server time once there is enough data. Deploys
  // only if the new model passes the gate (see train.js GATE).
  const retrain = setInterval(() => {
    const d = new Date();
    if (d.getHours() !== 3 || d.getMinutes() < 30 || d.getMinutes() > 31) return;
    const s = getState();
    const last = (s.models || []).at(-1);
    if (last && Date.now() - last.createdAt < 20 * 3600e3) return;
    const a = archiveSummary();
    if (!a.firstHour || (a.lastHour - a.firstHour) / 3600e3 < 24) return;
    api.startTraining({ deploy: true, reason: 'scheduled daily retrain' });
  }, 60e3);
  retrain.unref?.();

  process.on('exit', flushArchive);
  // the warning history was written at full detail before 21 Oct 2026; slim it once, in the background
  setTimeout(() => { compactArchive().catch((e) => console.warn(`[aiw] archive compaction failed: ${e.message}`)); }, 20e3).unref?.();
  console.log(`[aiw] started: ${history.length} strikes restored from archive, engine cycling every minute`);
  return { ingest, engine };
}
