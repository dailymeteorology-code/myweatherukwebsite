/**
 * Lightning capture on GitHub's servers, so no strike is lost while the PC — and so the site — is
 * off. Run by .github/workflows/lightning.yml.
 *
 *   Blitzortung   live, through the same intake the site's server uses (server/aiw/ingest.js:
 *                 validated, de-duplicated across its sockets)
 *   Met Office    the UK & Ireland feed, every 5 minutes
 *
 * Every 15 minutes each UTC day it has strikes for is merged into the `lightning-archive` release:
 * `bz-YYYY-MM-DD.csv.gz` and `mo-YYYY-MM-DD.csv.gz`, lines of "ms,lat,lon". Merging downloads
 * the day as it is, adds what is new (a strike reported twice, a few hundred ms apart, is one
 * strike) and uploads it over the old copy, so runs that overlap never lose each other's strikes.
 * The site's server pulls the days that cover any time it was off (server/lightning).
 *
 * A run lasts up to RUN_MIN minutes. At HANDOVER_MIN it starts the next run, so there is always
 * one listening; a run started by the schedule (or a push) steps aside if one already is, and
 * restarts the chain if it ever breaks. Days older than KEEP_DAYS are removed from the release.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createIngest } from '../../server/aiw/ingest.js';

const TAG = 'lightning-archive';
const RUN_MIN = Number(process.env.RUN_MIN || 335);
const HANDOVER_MIN = Number(process.env.HANDOVER_MIN || 300);
const FLUSH_MIN = 15;
const KEEP_DAYS = 45;
const LEELA = 'https://data.consumer-digital.api.metoffice.gov.uk/v1/lightning';
const WORK = process.env.RUNNER_TEMP ? path.join(process.env.RUNNER_TEMP, 'lx') : '/tmp/lx';
const started = Date.now();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', opts.quiet ? 'ignore' : 'inherit'], ...opts });
}

/* ── is someone already listening? ── */
function othersRunning() {
  if (!['schedule', 'push'].includes(process.env.GITHUB_EVENT_NAME)) return false;
  try {
    const runs = JSON.parse(gh(['run', 'list', '--workflow', 'lightning.yml', '--json', 'databaseId,status,createdAt', '--limit', '20'], { quiet: true }));
    return runs.some((r) => String(r.databaseId) !== process.env.GITHUB_RUN_ID && ['in_progress', 'queued'].includes(r.status)
      && Date.now() - Date.parse(r.createdAt) < 6 * 3600e3);
  } catch (e) { log('run list failed, capturing anyway:', e.message); return false; }
}

function ensureRelease() {
  try { gh(['release', 'view', TAG], { quiet: true }); } catch {
    gh(['release', 'create', TAG, '--title', 'Lightning archive', '--latest=false',
      '--notes', 'Every lightning strike, one file per UTC day, recorded on GitHub so nothing is lost while the site is offline. bz = Blitzortung.org (worldwide), mo = Met Office (UK & Ireland). Lines: epoch ms, lat, lon.']);
  }
}

function pruneOld() {
  try {
    const assets = JSON.parse(gh(['release', 'view', TAG, '--json', 'assets'], { quiet: true })).assets || [];
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86400e3).toISOString().slice(0, 10);
    for (const a of assets) {
      const m = /^(bz|mo)-(\d{4}-\d{2}-\d{2})\.csv\.gz$/.exec(a.name);
      if (m && m[2] < cutoff) { gh(['release', 'delete-asset', TAG, a.name, '-y'], { quiet: true }); log('removed', a.name); }
    }
  } catch (e) { log('prune skipped:', e.message); }
}

/* ── what this run has heard ── */
const days = { bz: new Map(), mo: new Map() };       // day -> Map(key -> line)
const dirty = { bz: new Set(), mo: new Set() };
const counts = { bz: 0, mo: 0 };
const keyOf = (src, t, la, lo) => (src === 'bz' ? `${Math.floor(t / 1000)}|${la.toFixed(3)}|${lo.toFixed(3)}` : `${t}|${la.toFixed(4)}|${lo.toFixed(4)}`);
function has(src, map, t, la, lo) {
  if (src === 'mo') return map.has(keyOf(src, t, la, lo));
  const s = Math.floor(t / 1000), tail = `|${la.toFixed(3)}|${lo.toFixed(3)}`;
  return map.has(`${s}${tail}`) || map.has(`${s - 1}${tail}`) || map.has(`${s + 1}${tail}`);
}
function add(src, t, la, lo) {
  const day = new Date(t).toISOString().slice(0, 10);
  let m = days[src].get(day);
  if (!m) { m = new Map(); days[src].set(day, m); }
  if (has(src, m, t, la, lo)) return;
  m.set(keyOf(src, t, la, lo), `${t},${la.toFixed(4)},${lo.toFixed(4)}`);
  dirty[src].add(day);
  counts[src] += 1;
}

/* ── merging a day into the release ── */
function mergeDay(src, day) {
  const name = `${src}-${day}.csv.gz`;
  const file = path.join(WORK, name);
  const mine = days[src].get(day);
  try {
    fs.rmSync(file, { force: true });
    gh(['release', 'download', TAG, '-p', name, '-D', WORK, '--clobber'], { quiet: true });
    const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const [t, la, lo] = line.split(',').map(Number);
      if (Number.isFinite(t) && !has(src, mine, t, la, lo)) mine.set(keyOf(src, t, la, lo), line);
    }
  } catch { /* the first copy of this day */ }
  const lines = [...mine.values()].sort((a, b) => Number(a.slice(0, a.indexOf(','))) - Number(b.slice(0, b.indexOf(','))));
  fs.writeFileSync(file, zlib.gzipSync(`${lines.join('\n')}\n`, { level: 9 }));
  gh(['release', 'upload', TAG, file, '--clobber'], { quiet: true });
  return lines.length;
}
function flush() {
  for (const src of ['bz', 'mo']) {
    for (const day of [...dirty[src]]) {
      try { const n = mergeDay(src, day); dirty[src].delete(day); log(`${src} ${day}: ${n} strikes in the archive`); } catch (e) { log(`upload ${src} ${day} failed:`, e.message); }
    }
    // a finished day is out of the way once it is safely uploaded
    const today = new Date().toISOString().slice(0, 10);
    for (const day of [...days[src].keys()]) if (day < today && !dirty[src].has(day) && Date.now() - Date.parse(`${day}T00:00:00Z`) > 26 * 3600e3) days[src].delete(day);
  }
}

/* ── Met Office ── */
async function pollMetOffice() {
  try {
    const get = async (q) => (await fetch(`${LEELA}?last-minutes=60${q}`, { headers: { 'User-Agent': 'MyWeatherUK-capture/1.0' }, signal: AbortSignal.timeout(30000) })).json();
    const first = await get('');
    let all = first.lightning_strikes || [];
    for (const c of first.chunks || []) { try { all = all.concat((await get(`&chunk=${c.chunk}`)).lightning_strikes || []); } catch { /* one chunk */ } }
    for (const s of all) {
      const [lo, la] = s.coordinates || [];
      const t = Date.parse(s.strike_time);
      if (Number.isFinite(t) && Number.isFinite(la) && Number.isFinite(lo)) add('mo', t, +la.toFixed(4), +lo.toFixed(4));
    }
  } catch (e) { log('Met Office poll failed:', e.message); }
}

async function main() {
  if (othersRunning()) { log('another capture run is listening; nothing to do'); return; }
  fs.mkdirSync(WORK, { recursive: true });
  ensureRelease();
  pruneOld();
  const ingest = createIngest({ archive: false });
  ingest.subscribe((batch) => { for (const s of batch) add('bz', s.time, s.lat, s.lon); });
  ingest.start();
  await pollMetOffice();
  const moTimer = setInterval(pollMetOffice, 5 * 60e3);
  let handedOver = false;
  let lastFlush = Date.now();
  while (Date.now() - started < RUN_MIN * 60e3) {
    await new Promise((r) => setTimeout(r, 30e3));
    const mins = (Date.now() - started) / 60e3;
    if (!handedOver && mins >= HANDOVER_MIN) {
      try { gh(['workflow', 'run', 'lightning.yml', '--ref', process.env.GITHUB_REF_NAME || 'main']); log('started the next run'); } catch (e) { log('hand-over failed (the schedule will restart the chain):', e.message); }
      handedOver = true;
    }
    if (Date.now() - lastFlush >= FLUSH_MIN * 60e3) {
      const st = ingest.status().blitzortung;
      log(`heard ${counts.bz} Blitzortung (${st?.sockets ?? 0} sockets, ${st?.status}) and ${counts.mo} Met Office strikes so far`);
      flush();
      lastFlush = Date.now();
    }
  }
  clearInterval(moTimer);
  ingest.stop();
  flush();
  log(`done: ${counts.bz} Blitzortung and ${counts.mo} Met Office strikes heard`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
