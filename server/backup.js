/**
 * Backup and restore for the self-hosted site.
 *
 * Everything that can't be rebuilt from source lives in two places:
 *
 *   server/data/db.json   site content, settings, accounts, sessions
 *   server/uploads/       images and files uploaded through the site
 *
 * plus `.env`, which holds your API keys. A backup is a timestamped folder
 * under backups/ containing copies of those, and a manifest recording what was
 * in it. Restoring is a straight copy back — no archive format to get wrong,
 * and you can open any backup and read it.
 *
 * Used two ways: from the CLI (`npm run backup`), and from the server, which
 * takes one on boot and then on a timer.
 *
 * Note the backups land inside the OneDrive folder, so they are also synced
 * off this machine. That is deliberate — but it means a backup is only as
 * private as your OneDrive, and .env holds secrets. Pass --no-env (or set
 * BACKUP_INCLUDE_ENV=false) to leave it out.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const DB_PATH = path.join(here, 'data', 'db.json');
const UPLOAD_DIR = path.join(here, 'uploads');
const ENV_PATH = path.join(ROOT, '.env');
const BACKUP_ROOT = path.join(ROOT, 'backups');

/** Keep this many backups; the oldest are pruned beyond it. 0 = keep all. */
const DEFAULT_KEEP = Number(process.env.BACKUP_KEEP ?? 20);

/** A folder name that sorts chronologically and is legal on Windows. */
function stamp(date = new Date()) {
  return date.toISOString().replace(/:/g, '-').replace(/\..+$/, '');
}

function dirSize(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Row counts per collection, so a manifest says what the backup holds. */
function summarise(dbFile) {
  if (!fs.existsSync(dbFile)) return { readable: false };
  try {
    const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const collections = {};
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value)) collections[key] = value.length;
    }
    return {
      readable: true,
      accounts: Array.isArray(data._users) ? data._users.length : 0,
      collections,
      totalRows: Object.values(collections).reduce((a, b) => a + b, 0),
    };
  } catch (err) {
    return { readable: false, error: err.message };
  }
}

/**
 * Take a backup. Returns the manifest.
 * `reason` is recorded so you can tell a scheduled backup from one you asked
 * for, or from the safety copy taken before a restore.
 */
export function createBackup({ reason = 'manual', includeEnv = true, keep = DEFAULT_KEEP } = {}) {
  const name = stamp();
  const dest = path.join(BACKUP_ROOT, name);
  fs.mkdirSync(dest, { recursive: true });

  const contents = [];

  if (fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, path.join(dest, 'db.json'));
    contents.push('db.json');
  }

  if (fs.existsSync(UPLOAD_DIR) && fs.readdirSync(UPLOAD_DIR).length) {
    fs.cpSync(UPLOAD_DIR, path.join(dest, 'uploads'), { recursive: true });
    contents.push('uploads/');
  }

  if (includeEnv && fs.existsSync(ENV_PATH)) {
    fs.copyFileSync(ENV_PATH, path.join(dest, 'env.txt'));
    contents.push('env.txt');
  }

  const manifest = {
    created: new Date().toISOString(),
    reason,
    contents,
    database: summarise(path.join(dest, 'db.json')),
    uploads: {
      files: fs.existsSync(path.join(dest, 'uploads'))
        ? fs.readdirSync(path.join(dest, 'uploads')).length
        : 0,
    },
    sizeBytes: dirSize(dest),
  };
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
  manifest.path = dest;
  manifest.name = name;

  pruneBackups(keep);
  return manifest;
}

/** Newest first. */
export function listBackups() {
  if (!fs.existsSync(BACKUP_ROOT)) return [];
  return fs
    .readdirSync(BACKUP_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = path.join(BACKUP_ROOT, e.name);
      let manifest = {};
      try {
        manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      } catch {
        /* a backup without a readable manifest is still a backup */
      }
      return { name: e.name, path: dir, ...manifest };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Delete all but the newest `keep`. Safety copies are never pruned. */
export function pruneBackups(keep = DEFAULT_KEEP) {
  if (!keep || keep <= 0) return [];
  const all = listBackups();
  const prunable = all.filter((b) => b.reason !== 'pre-restore');
  const removed = [];
  for (const backup of prunable.slice(keep)) {
    fs.rmSync(backup.path, { recursive: true, force: true });
    removed.push(backup.name);
  }
  return removed;
}

/**
 * Restore a backup over the live data. Takes a `pre-restore` backup of the
 * current state first, so a restore is itself undoable.
 */
export function restoreBackup(nameOrPath) {
  const dir = path.isAbsolute(nameOrPath) ? nameOrPath : path.join(BACKUP_ROOT, nameOrPath);
  if (!fs.existsSync(dir)) throw new Error(`No such backup: ${nameOrPath}`);
  const sourceDb = path.join(dir, 'db.json');
  if (!fs.existsSync(sourceDb)) throw new Error(`Backup has no db.json: ${dir}`);

  // Fail before touching anything if the backup is corrupt.
  JSON.parse(fs.readFileSync(sourceDb, 'utf8'));

  const safety = createBackup({ reason: 'pre-restore', keep: 0 });

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.copyFileSync(sourceDb, DB_PATH);

  const sourceUploads = path.join(dir, 'uploads');
  if (fs.existsSync(sourceUploads)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.cpSync(sourceUploads, UPLOAD_DIR, { recursive: true });
  }

  return { restored: path.basename(dir), safetyCopy: safety.name };
}

/* ── CLI ────────────────────────────────────────────────────────────────── */

function cli() {
  const args = process.argv.slice(2);
  const command = args.find((a) => !a.startsWith('--')) || 'create';
  const flag = (name) => args.includes(`--${name}`);

  if (command === 'list') {
    const all = listBackups();
    if (!all.length) {
      console.log('\nNo backups yet. Run `npm run backup` to make one.\n');
      return;
    }
    console.log(`\n${all.length} backup(s), newest first:\n`);
    for (const b of all) {
      const rows = b.database?.totalRows ?? '?';
      console.log(
        `  ${b.name}   ${String(rows).padStart(6)} rows  ` +
          `${formatBytes(b.sizeBytes || 0).padStart(9)}  ${b.reason || ''}`
      );
    }
    console.log('');
    return;
  }

  if (command === 'restore') {
    const target = args.find((a) => !a.startsWith('--') && a !== 'restore');
    if (!target) {
      console.error('\nUsage: npm run backup:restore -- <backup-name>');
      console.error('Run `npm run backup:list` to see the names.\n');
      process.exit(1);
    }
    const result = restoreBackup(target);
    console.log(`\nRestored ${result.restored}.`);
    console.log(`Previous state saved as ${result.safetyCopy} in case you need it back.`);
    console.log('Restart the server to pick it up.\n');
    return;
  }

  const manifest = createBackup({
    reason: 'manual',
    includeEnv: !flag('no-env') && process.env.BACKUP_INCLUDE_ENV !== 'false',
  });
  console.log(`\nBacked up to backups/${manifest.name}`);
  console.log(`  contents:  ${manifest.contents.join(', ') || '(nothing to back up yet)'}`);
  if (manifest.database?.readable) {
    console.log(`  database:  ${manifest.database.totalRows} rows across ` +
      `${Object.keys(manifest.database.collections).length} collections, ` +
      `${manifest.database.accounts} account(s)`);
  }
  console.log(`  uploads:   ${manifest.uploads.files} file(s)`);
  console.log(`  size:      ${formatBytes(manifest.sizeBytes)}\n`);
}

// Only run the CLI when invoked directly, not when imported by the server.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    cli();
  } catch (err) {
    console.error(`\nBackup failed: ${err.message}\n`);
    process.exit(1);
  }
}
