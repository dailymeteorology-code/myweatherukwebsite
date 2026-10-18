/**
 * TCM V3 — AWS runs made on GitHub (.github/workflows/tcm-v3.yml), mirrored here.
 *
 * Every 10 minutes this pulls the `tcm-v3` release; when a new run appears it
 *   - keeps the full payload on disk and serves it at /api/tcm-v3/latest (the V3 page's
 *     "Run Model"/due-check path reads this — Open-Meteo is no longer used), and
 *   - upserts the RiskGridCache rows V3's own saveTCMRunToDB produced on GitHub, so every
 *     visitor's normal DB read shows the new run even if no admin opens the page.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.NOVA_REPO || 'dailymeteorology-code/myweatherukwebsite';
const DIR = process.env.TCM_V3_DATA || (fs.existsSync('D:/') ? 'D:/TCM-NOVA/tcm-v3' : path.join(here, 'data', 'tcm-v3'));
let state = { last: null, error: null, run: null };

async function assets() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/tcm-v3`, { headers: { 'User-Agent': 'MyWeatherUK-TCM-V3' } });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return (await r.json()).assets || [];
}

async function download(a) {
  const r = await fetch(a.browser_download_url, { headers: { 'User-Agent': 'MyWeatherUK-TCM-V3' } });
  if (!r.ok) throw new Error(`${a.name}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function upsertRows(rows) {
  for (const row of rows) {
    const { id, ...rest } = row;          // ids are GitHub-side stand-ins; the local DB assigns its own
    const existing = db.list('RiskGridCache', { query: { cache_key: rest.cache_key }, limit: 1 })?.[0];
    if (existing) db.update('RiskGridCache', existing.id, rest);
    else db.create('RiskGridCache', rest);
  }
}

export async function syncTcmV3() {
  try {
    const list = await assets();
    const pay = list.find((a) => a.name === 'payload.json.gz');
    const rowsA = list.find((a) => a.name === 'db-rows.json.gz');
    if (!pay || !rowsA) { state = { ...state, last: new Date().toISOString(), error: 'no run published yet' }; return; }
    const marker = path.join(DIR, 'synced.json');
    const prev = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : {};
    if (prev.updated_at === pay.updated_at) { state = { ...state, last: new Date().toISOString(), error: null }; return; }
    fs.mkdirSync(DIR, { recursive: true });
    const payload = zlib.gunzipSync(await download(pay));
    const rows = JSON.parse(zlib.gunzipSync(await download(rowsA)).toString());
    fs.writeFileSync(path.join(DIR, 'latest.json'), payload);
    upsertRows(rows);
    fs.writeFileSync(marker, JSON.stringify({ updated_at: pay.updated_at, rows: rows.map((r) => r.cache_key) }));
    const run = JSON.parse(payload.toString()).run;
    state = { last: new Date().toISOString(), error: null, run };
    console.log(`[tcm-v3] synced AWS run ${run} (${rows.length} DB rows)`);
  } catch (e) {
    state = { ...state, last: new Date().toISOString(), error: String(e.message || e) };
    console.warn(`[tcm-v3] sync failed: ${e.message}`);
  }
}

export function mountTcmV3(app, { sync = true } = {}) {
  app.get('/api/tcm-v3/latest', (req, res) => {
    const f = path.join(DIR, 'latest.json');
    if (!fs.existsSync(f)) return res.status(404).json({ error: 'no TCM V3 AWS run synced yet', sync: state });
    res.set('Cache-Control', 'no-cache');
    res.type('application/json').send(fs.readFileSync(f));
  });
  app.get('/api/tcm-v3/status', (req, res) => res.json({ ...state, schedule: '03:00 and 15:00 Europe/London, GitHub Actions, AWS data' }));
  if (sync) {
    syncTcmV3();
    setInterval(syncTcmV3, 10 * 60000);
  }
}
