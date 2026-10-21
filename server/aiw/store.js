/**
 * Storage for the AI lightning warning system.
 *
 * Kept OUT of db.json on purpose. db.json is rewritten whole on every change,
 * which is fine for a few hundred settings rows and hopeless for a lightning
 * archive that grows by tens of thousands of strikes an hour. So:
 *
 *   data/aiw/strikes/YYYY-MM-DD/HH.csv   the observed strike archive, one file
 *                                         per UTC hour, appended in batches.
 *                                         "epochMs,lat,lon" per line. This is
 *                                         the training and verification data.
 *   data/aiw/state.json                  warnings, events, announcements,
 *                                         config, audit log, model registry.
 *                                         Small, rewritten atomically.
 *   data/aiw/models/<version>.json       trained model files + their metrics.
 *
 * Writes go through write-then-rename with retries, because this project lives
 * under OneDrive and Windows routinely holds a file open for an instant during
 * sync — the same failure db.js already guards against.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const AIW_DIR = process.env.AIW_DATA_DIR || path.join(here, '..', 'data', 'aiw');
export const STRIKE_DIR = path.join(AIW_DIR, 'strikes');
/* What training learns from: the site's lightning archive (server/lightning), which holds every
   Blitzortung strike this server saw plus whatever the GitHub capture recorded while it was off,
   in the same hour-file layout. Falls back to this system's own archive. */
const LIGHTNING_BZ = 'D:/MyWeatherUK-data/lightning/bz';
export const TRAIN_STRIKE_DIR = process.env.AIW_TRAIN_STRIKES || (fs.existsSync(LIGHTNING_BZ) ? LIGHTNING_BZ : STRIKE_DIR);
export const MODEL_DIR = path.join(AIW_DIR, 'models');
const STATE_PATH = path.join(AIW_DIR, 'state.json');

const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES']);
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/** Atomic JSON write with the Windows/OneDrive retry dance. */
export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const json = JSON.stringify(value);
  fs.writeFileSync(tmp, json);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try { fs.renameSync(tmp, file); return; } catch (err) {
      if (!LOCKED.has(err.code) || attempt === 5) break;
      sleepSync(attempt * 20);
    }
  }
  fs.writeFileSync(file, json);
  fs.rmSync(tmp, { force: true });
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/* ── state (warnings, events, config, audit…) ─────────────────────────── */

const EMPTY_STATE = () => ({
  version: 1,
  warnings: [],        // AiWarning records (current version of each)
  events: [],          // lifecycle events, append-only audit trail
  announcements: [],   // spoken-announcement events with unique ids
  audit: [],           // administrator actions
  health: {},          // data-source health snapshots
  config: null,        // decision thresholds (null = use defaults)
  models: [],          // model registry entries
  activeModel: null,   // version id of the deployed model
  paused: false,       // admin kill-switch for automated issuance
  seq: 0,              // monotonic counter for human-readable ids
});

let state = null;
let saveTimer = null;

export function getState() {
  if (!state) state = { ...EMPTY_STATE(), ...readJson(STATE_PATH, {}) };
  return state;
}

/** Coalesce bursts of changes into one write. */
export function saveState({ now = false } = {}) {
  if (now) {
    clearTimeout(saveTimer); saveTimer = null;
    writeJsonAtomic(STATE_PATH, state);
    return;
  }
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; writeJsonAtomic(STATE_PATH, state); }, 500);
  saveTimer.unref?.();
}

/** Tests use an isolated in-memory state. */
export function _setStateForTests(s) { state = { ...EMPTY_STATE(), ...s }; }

/* ── strike archive ───────────────────────────────────────────────────── */

function hourFile(ms, dir = STRIKE_DIR) {
  const d = new Date(ms);
  const day = d.toISOString().slice(0, 10);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return path.join(dir, day, `${hh}.csv`);
}

let pending = [];
let flushTimer = null;

/** Queue strikes for the archive; flushed every few seconds in one append per file. */
export function archiveStrikes(strikes) {
  for (const s of strikes) pending.push(s);
  if (!flushTimer) {
    flushTimer = setTimeout(flushArchive, 5000);
    flushTimer.unref?.();
  }
}

export function flushArchive() {
  clearTimeout(flushTimer); flushTimer = null;
  if (!pending.length) return;
  const byFile = new Map();
  for (const s of pending) {
    const f = hourFile(s.time);
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(`${s.time},${s.lat.toFixed(4)},${s.lon.toFixed(4)}`);
  }
  pending = [];
  for (const [file, lines] of byFile) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try { fs.appendFileSync(file, lines.join('\n') + '\n'); break; } catch (err) {
        if (!LOCKED.has(err.code) || attempt === 5) { console.error('[aiw] archive write failed', file, err.code); break; }
        sleepSync(attempt * 20);
      }
    }
  }
}

/** Read archived strikes in [fromMs, toMs). Sorted by time. */
export function readStrikes(fromMs, toMs, dir = STRIKE_DIR) {
  const out = [];
  const start = Math.floor(fromMs / 3600e3) * 3600e3;
  for (let h = start; h < toMs; h += 3600e3) {
    let text;
    try { text = fs.readFileSync(hourFile(h, dir), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      const a = line.split(',');
      const t = Number(a[0]);
      if (t >= fromMs && t < toMs) out.push({ time: t, lat: Number(a[1]), lon: Number(a[2]) });
    }
  }
  out.sort((x, y) => x.time - y.time);
  return out;
}

/** Hours of archive available, for the training report and the admin panel. */
export function archiveSummary(dir = STRIKE_DIR) {
  let files = 0; let bytes = 0; let first = null; let last = null;
  let days = [];
  try { days = fs.readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort(); } catch { /* none yet */ }
  for (const day of days) {
    let hours = [];
    try { hours = fs.readdirSync(path.join(dir, day)).filter((h) => /^\d{2}\.csv$/.test(h)).sort(); } catch { continue; }
    for (const h of hours) {
      files += 1;
      try { bytes += fs.statSync(path.join(dir, day, h)).size; } catch { /* ignore */ }
      const ms = Date.parse(`${day}T${h.slice(0, 2)}:00:00Z`);
      if (first == null || ms < first) first = ms;
      if (last == null || ms > last) last = ms;
    }
  }
  return { hourFiles: files, bytes, firstHour: first, lastHour: last };
}

/** Delete archive days older than the retention window. */
export function pruneArchive(keepDays = Number(process.env.AIW_ARCHIVE_DAYS || 90)) {
  const cutoff = new Date(Date.now() - keepDays * 86400e3).toISOString().slice(0, 10);
  let days = [];
  try { days = fs.readdirSync(STRIKE_DIR); } catch { return; }
  for (const d of days) if (d < cutoff) fs.rmSync(path.join(STRIKE_DIR, d), { recursive: true, force: true });
}
