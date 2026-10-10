/**
 * JSON-file datastore standing in for Base44's hosted database.
 *
 * One file, one process, synchronous writes — deliberately boring. This is a
 * single-operator site running on one PC; there is no reason to run a database
 * server on the box just to serve it. If the collections ever outgrow that
 * (the lightning tables are the ones that would), swap this module for SQLite:
 * every caller goes through the small surface below.
 *
 * Collections are created on demand, so an entity added to a future export
 * needs no change here. The known list below only seeds the empty file and
 * documents what the app expects.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(here, 'data', 'db.json');
const SEED_PATH = path.join(here, 'data', 'seed.json');
const SCHEMA_DIR = path.join(here, 'schemas');

/**
 * Entity names, read from the schemas copied out of the Base44 export.
 * MapProject and NewsArticle are referenced by the app but have no schema file
 * in the export, so they are named explicitly.
 */
function knownEntities() {
  let fromSchemas = [];
  try {
    fromSchemas = fs
      .readdirSync(SCHEMA_DIR)
      .filter((f) => f.endsWith('.jsonc'))
      .map((f) => f.replace(/\.jsonc$/, ''));
  } catch {
    /* schemas are documentation here, not a hard requirement */
  }
  return [...new Set([...fromSchemas, 'MapProject', 'NewsArticle'])].sort();
}

export const ENTITIES = knownEntities();

/** Internal keys in the JSON file that are not entity collections. */
const INTERNAL = new Set(['_users', '_sessions', '_logs', '_comment']);

/** Reject anything that isn't a plain entity name before it reaches the store. */
export function isValidEntityName(name) {
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name);
}

let cache = null;

function emptyDb() {
  const db = { _users: [], _sessions: {}, _logs: [] };
  for (const name of ENTITIES) db[name] = [];
  return db;
}

function load() {
  if (cache) return cache;
  if (fs.existsSync(DB_PATH)) {
    try {
      cache = { ...emptyDb(), ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
      return cache;
    } catch (err) {
      // A corrupt db.json should not take the site down. Keep the bad file so
      // it can be inspected, and carry on from the seed.
      const backup = `${DB_PATH}.corrupt-${Date.now()}`;
      fs.renameSync(DB_PATH, backup);
      console.error(`[db] db.json was unreadable (${err.message}); moved to ${backup}`);
    }
  }
  const seed = fs.existsSync(SEED_PATH) ? JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) : {};
  cache = { ...emptyDb(), ...seed };
  persist();
  return cache;
}

let writeTimer = null;

/** Block the thread briefly — only used between rename retries below. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const RENAME_ATTEMPTS = 5;
/** Transient Windows file-lock errors, as opposed to a real failure. */
const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES']);

function persist() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  const json = JSON.stringify(cache, null, 2);
  fs.writeFileSync(tmp, json);

  // Write-then-rename, so a crash mid-write can't truncate the live file.
  //
  // On Windows that rename intermittently fails with EPERM/EBUSY when another
  // process has the target open even for an instant. This project lives under
  // OneDrive, whose sync client does exactly that, and Defender does too — so
  // the failure is routine here, not exceptional. Retry with a short backoff,
  // and if it still won't budge, write in place: a torn file is a far smaller
  // risk than dropping the write and telling the caller it succeeded.
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt += 1) {
    try {
      fs.renameSync(tmp, DB_PATH);
      return;
    } catch (err) {
      if (!LOCKED.has(err.code) || attempt === RENAME_ATTEMPTS) break;
      sleepSync(attempt * 20); // 20ms, 40ms, 60ms, 80ms
    }
  }

  try {
    fs.writeFileSync(DB_PATH, json);
    fs.rmSync(tmp, { force: true });
  } catch (err) {
    // Out of options. Say so loudly — the tmp file still holds the data.
    console.error(
      `[db] could not save db.json (${err.code || err.message}). ` +
        `Your latest changes are in ${path.basename(tmp)}.`
    );
  }
}

/**
 * Bulk lightning imports write thousands of rows in a burst; writing the whole
 * file per row would dominate the request. Coalesce those into one write.
 */
function persistSoon() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    persist();
  }, 200);
  writeTimer.unref?.();
}

const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomBytes(12).toString('hex');

/**
 * Base44 sort strings are a field name, optionally prefixed with '-' for
 * descending: '-created_date', 'valid_from'.
 */
function applySort(rows, sort) {
  if (!sort) return rows;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  return [...rows].sort((a, b) => {
    const av = a?.[field];
    const bv = b?.[field];
    if (av === bv) return 0;
    if (av == null) return 1; // missing values sort last either way
    if (bv == null) return -1;
    const cmp = av > bv ? 1 : -1;
    return desc ? -cmp : cmp;
  });
}

/** Base44's filter() is equality matching; an array field matches on contains. */
function matches(row, query) {
  return Object.entries(query).every(([key, want]) => {
    const have = row?.[key];
    if (Array.isArray(have)) return have.includes(want);
    return have === want;
  });
}

function collection(data, entity) {
  if (!Array.isArray(data[entity])) data[entity] = [];
  return data[entity];
}

export const db = {
  /** Entity names that currently exist in the file, for diagnostics. */
  collections() {
    return Object.keys(load()).filter((k) => !INTERNAL.has(k));
  },

  list(entity, { query, sort, limit } = {}) {
    const data = load();
    let rows = Array.isArray(data[entity]) ? data[entity] : [];
    if (query && Object.keys(query).length) rows = rows.filter((r) => matches(r, query));
    rows = applySort(rows, sort);
    if (limit != null) rows = rows.slice(0, Number(limit));
    return rows;
  },

  get(entity, id) {
    return load()[entity]?.find((r) => r.id === id) || null;
  },

  create(entity, payload) {
    const data = load();
    const rows = collection(data, entity);
    const row = {
      ...payload,
      id: payload.id || newId(),
      created_date: payload.created_date || nowIso(),
      updated_date: nowIso(),
    };
    rows.push(row);
    persist();
    return row;
  },

  /** Used by the lightning importers, which insert in large batches. */
  bulkCreate(entity, payloads) {
    const data = load();
    const rows = collection(data, entity);
    const created = payloads.map((payload) => ({
      ...payload,
      id: payload.id || newId(),
      created_date: payload.created_date || nowIso(),
      updated_date: nowIso(),
    }));
    rows.push(...created);
    persistSoon();
    return created;
  },

  update(entity, id, patch) {
    const data = load();
    const rows = data[entity];
    if (!Array.isArray(rows)) return null;
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    rows[idx] = { ...rows[idx], ...patch, id, updated_date: nowIso() };
    persist();
    return rows[idx];
  },

  remove(entity, id) {
    const data = load();
    const rows = data[entity];
    if (!Array.isArray(rows)) return false;
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    rows.splice(idx, 1);
    persist();
    return true;
  },

  /* ── accounts ─────────────────────────────────────────────────────────── */

  findUser(predicate) {
    return load()._users.find(predicate) || null;
  },

  findUserByEmail(email) {
    const wanted = String(email || '').trim().toLowerCase();
    return db.findUser((u) => u.email?.toLowerCase() === wanted);
  },

  findUserById(id) {
    return db.findUser((u) => u.id === id);
  },

  listUsers() {
    return [...load()._users];
  },

  createUser(user) {
    const data = load();
    const row = { ...user, id: user.id || newId(), created_date: nowIso() };
    data._users.push(row);
    persist();
    return row;
  },

  updateUser(id, patch) {
    const data = load();
    const idx = data._users.findIndex((u) => u.id === id);
    if (idx === -1) return null;
    data._users[idx] = { ...data._users[idx], ...patch, id };
    persist();
    return data._users[idx];
  },

  removeUser(id) {
    const data = load();
    const idx = data._users.findIndex((u) => u.id === id);
    if (idx === -1) return false;
    data._users.splice(idx, 1);
    // Drop any sessions the deleted account still held.
    for (const [token, session] of Object.entries(data._sessions)) {
      if (session.userId === id) delete data._sessions[token];
    }
    persist();
    return true;
  },

  /* ── sessions ─────────────────────────────────────────────────────────── */

  createSession(userId, ttlMs) {
    const data = load();
    const token = crypto.randomBytes(32).toString('hex');
    data._sessions[token] = { userId, expires: Date.now() + ttlMs };
    persist();
    return token;
  },

  /** Returns the session's user, or null when the token is unknown/expired. */
  resolveSession(token) {
    if (!token) return null;
    const data = load();
    const session = data._sessions[token];
    if (!session) return null;
    if (session.expires && session.expires < Date.now()) {
      delete data._sessions[token];
      persist();
      return null;
    }
    return db.findUserById(session.userId);
  },

  destroySession(token) {
    const data = load();
    if (!data._sessions[token]) return false;
    delete data._sessions[token];
    persist();
    return true;
  },

  /* ── page-view log ────────────────────────────────────────────────────── */

  /** Kept short — this is a local analytics breadcrumb, not an audit trail. */
  logPageView(entry) {
    const data = load();
    data._logs.push(entry);
    if (data._logs.length > 1000) data._logs.splice(0, data._logs.length - 1000);
    persistSoon();
    return entry;
  },

  recentLogs(limit = 100) {
    return load()._logs.slice(-limit).reverse();
  },
};

export default db;
