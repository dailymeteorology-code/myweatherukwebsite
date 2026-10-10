/**
 * Live scenarios on the self-hosted server.
 *
 * Two sources, newest wins:
 *  - GitHub: the scheduled workflow publishes live-scenarios.json to the
 *    `live-data` branch every day at 06:00 UK time, even when this PC is off.
 *    The server checks it on start-up and every 30 minutes.
 *  - Local: if this server is running at 06:00 UK time it also builds the
 *    scenarios itself (and on start-up if nothing is newer than 24 h).
 *
 *   GET /api/scenarios/live   → the latest result (404 until one exists)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLive } from './run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const LOCAL = path.resolve(here, '../../data/scenarios-local/live-scenarios.json');
const GH_URL = process.env.LIVE_SCENARIOS_URL || 'https://raw.githubusercontent.com/dailymeteorology-code/myweatherukwebsite/live-data/live-scenarios.json';

let current = null;
let building = false;
let lastError = null;

const ageH = (r) => (r ? (Date.now() - Date.parse(r.issued)) / 3.6e6 : Infinity);
function consider(r, from) {
  if (!r?.scenarios?.length) return;
  if (!current || Date.parse(r.issued) > Date.parse(current.issued)) current = { ...r, source: from };
}
function loadLocal() { try { consider(JSON.parse(fs.readFileSync(LOCAL, 'utf8')), 'local'); } catch { /* none yet */ } }
async function pullGitHub() {
  try {
    const res = await fetch(`${GH_URL}?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
    if (res.ok) consider(await res.json(), 'github');
  } catch { /* offline */ }
}
async function buildLocal(reason) {
  if (building) return;
  building = true;
  console.log(`[live-scenarios] building (${reason})`);
  try { consider(await runLive({ out: LOCAL, log: (m) => console.log(`[live-scenarios] ${m}`) }), 'local'); lastError = null; } catch (e) { lastError = e.message; console.warn('[live-scenarios] failed:', e.message); }
  building = false;
}

/** Hour and date in UK local time (handles BST automatically). */
function ukNow() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t)?.value;
  return { hour: +g('hour'), minute: +g('minute'), date: `${g('year')}-${g('month')}-${g('day')}` };
}

export function startLiveScenarios(app) {
  app.get('/api/scenarios/live', (req, res) => {
    if (!current) return res.status(404).json({ error: building ? 'Building the scenarios — this takes a few seconds.' : 'No live scenarios yet.', building, lastError });
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ ...current, building, ageHours: Math.round(ageH(current) * 10) / 10 });
  });

  loadLocal();
  pullGitHub().then(() => { if (ageH(current) > 24) buildLocal('no data from the last 24 hours'); });

  let ranOn = null;
  setInterval(() => {
    const t = ukNow();
    if (t.hour === 6 && ranOn !== t.date) {
      ranOn = t.date;
      buildLocal('daily 06:00 run');
    }
  }, 60_000);
  setInterval(pullGitHub, 30 * 60_000);
}
