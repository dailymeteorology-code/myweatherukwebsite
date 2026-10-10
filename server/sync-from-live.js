#!/usr/bin/env node
/**
 * Pull live content from the Base44 app into the local database.
 *
 * The code in this project came from a git export dated 3-5 July 2026, but the
 * *content* — graphics, TCM outlooks, verification history, site settings —
 * lives in the Base44 cloud and keeps changing. This script copies it down.
 *
 * It reads the app's public entity API, the same unauthenticated endpoint the
 * live site itself uses to render for logged-out visitors:
 *
 *     GET https://base44.app/api/apps/<appId>/entities/<Name>
 *
 * Nothing here signs in, and nothing is written back to Base44 — it is a
 * one-way, read-only copy into server/data/db.json.
 *
 * Usage:
 *   node server/sync-from-live.js --dry-run          # report only, writes nothing
 *   node server/sync-from-live.js                    # sync every entity
 *   node server/sync-from-live.js --entities=WeatherGraphic,TCMOutlook
 *   node server/sync-from-live.js --mirror-images    # also download images locally
 *
 * Your local accounts and sessions are never touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(here, 'data', 'db.json');
const UPLOAD_DIR = path.join(here, 'uploads');

const APP_ID = process.env.BASE44_APP_ID || '69945c97e07811f2b5427aa6';
const API = `https://base44.app/api/apps/${APP_ID}`;

/** Collections to pull. Extra names can be added with --entities. */
const DEFAULT_ENTITIES = [
  'Announcement',
  'AppUpdate',
  'CachedWarnings',
  'ClimateNormal',
  'ForecastVerification',
  'ManualWarning',
  'MenuItemConfig',
  'ModelBiasCalibration',
  'ModelFeedback',
  'NewsArticle',
  'NewsletterSubscriber',
  'PublishedFeatures',
  'SiteSettings',
  'StudioGraphic',
  'SubscriptionMatrix',
  'SubscriptionPlan',
  'TCMCalibrationRun',
  'TCMOutlook',
  'TCMRiskOverride',
  'WeatherGraphic',
];

/**
 * Deliberately not synced by default. Pull any of them explicitly with
 * --entities=Name if you actually want them.
 *
 *   LightningArchive, LightningStrike, ModelRunCache, RiskGridCache
 *       Big. LightningArchive and RiskGridCache both time out past 180s
 *       building their response, and all four are derived data the app
 *       regenerates — not content you would lose.
 *   AccessRequest, EmailNotificationPref, LocationSearchHistory
 *       Per-visitor records tied to the hosted site's accounts.
 *   User, UserSubscription, SiteAccessCode, SubscriptionCoupon, SubscriptionSale
 *       Account and billing records; local auth is separate.
 *   MapProject
 *       Referenced in the app code but returns 404 — no such entity live.
 */

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const DRY_RUN = has('--dry-run');
const MIRROR = has('--mirror-images');
const only = valueOf('entities');
const ENTITIES = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ENTITIES;

/** Per-request budget. The lightning tables are large and slow to serialise. */
const TIMEOUT_MS = Number(process.env.SYNC_TIMEOUT_MS || 180_000);

/**
 * Fetch one collection. Never throws: a collection that times out or errors is
 * reported and skipped, because one slow table must not abandon the whole sync
 * (and leave the rest of the site un-synced).
 */
async function fetchEntity(name, attempt = 1) {
  try {
    const res = await fetch(`${API}/entities/${name}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { name, error: `HTTP ${res.status}` };

    const body = await res.json();
    if (!Array.isArray(body)) return { name, error: 'unexpected response shape' };
    return { name, rows: body };
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || /abort/i.test(err.message);
    if (timedOut && attempt === 1) {
      // One retry — these timeouts are usually the server building a big
      // response, and the second attempt often lands on a warm cache.
      process.stdout.write('retrying… ');
      return fetchEntity(name, 2);
    }
    return {
      name,
      error: timedOut ? `timed out after ${TIMEOUT_MS / 1000}s` : err.message,
    };
  }
}

/**
 * Download an image served by Base44 into server/uploads and hand back the
 * local URL, so the site keeps working if the remote asset ever goes away.
 * Anything that isn't a Base44-hosted URL is left alone.
 */
const mirrored = new Map();

async function mirrorImage(url) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return url;
  if (!/base44\.app|base44\.com/.test(url)) return url;
  if (mirrored.has(url)) return mirrored.get(url);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    const type = res.headers.get('content-type') || '';
    const ext =
      /png/.test(type) ? 'png'
      : /jpe?g/.test(type) ? 'jpg'
      : /webp/.test(type) ? 'webp'
      : /gif/.test(type) ? 'gif'
      : /svg/.test(type) ? 'svg'
      : path.extname(new URL(url).pathname).replace('.', '') || 'bin';

    // Name by content so the same image fetched twice lands in one file.
    const hash = (await import('node:crypto'))
      .createHash('sha1')
      .update(buf)
      .digest('hex')
      .slice(0, 16);
    const filename = `live-${hash}.${ext}`;

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const dest = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);

    const local = `/uploads/${filename}`;
    mirrored.set(url, local);
    return local;
  } catch (err) {
    console.warn(`    ! could not mirror ${url.slice(0, 70)}… (${err.message})`);
    mirrored.set(url, url); // leave the remote URL in place
    return url;
  }
}

/** Fields that hold an image URL worth mirroring. */
const IMAGE_FIELDS = [
  'image_url',
  'logo_url',
  'banner_url',
  'tcm_logo_url',
  'thumbnail_url',
  'photo_url',
  'photoUrl',
  'file_url',
];

async function mirrorRowImages(rows) {
  let count = 0;
  for (const row of rows) {
    for (const field of IMAGE_FIELDS) {
      if (row?.[field]) {
        const next = await mirrorImage(row[field]);
        if (next !== row[field]) {
          row[field] = next;
          count += 1;
        }
      }
    }
  }
  return count;
}

/**
 * Collections the app treats as a single record: it calls `.list()` with no
 * sort and reads `[0]`, so whichever row lands first decides the logo, the
 * landing page and the site-disabled flag.
 *
 * The live API hands these back oldest-first, and the app has accumulated
 * stale rows over time (17 SiteSettings records, most of them abandoned
 * "My Site" placeholders from a first run). Taking [0] verbatim would boot the
 * site with months-old branding. Put the most recently updated row first so
 * the current settings win.
 */
const SINGLETON_COLLECTIONS = new Set(['SiteSettings']);

const editedAt = (row) => Date.parse(row?.updated_date || row?.created_date || 0) || 0;

function orderForApp(name, rows) {
  if (!SINGLETON_COLLECTIONS.has(name) || rows.length < 2) return rows;
  return [...rows].sort((a, b) => editedAt(b) - editedAt(a));
}

/**
 * Refuse to write while the server is up.
 *
 * The server keeps the whole database in memory and rewrites db.json from that
 * cache on its next write — a page view is enough. So a sync that lands while
 * it is running can be silently undone minutes later, which looks exactly like
 * content mysteriously disappearing. Writing only while it is stopped removes
 * the race entirely.
 */
async function serverIsRunning() {
  const port = Number(process.env.API_PORT || 8787);
  try {
    const res = await fetch(`http://localhost:${port}/api/entities/SiteSettings`, {
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`\nSyncing from ${API}`);
  console.log(DRY_RUN ? 'DRY RUN — nothing will be written.\n' : '');

  if (!DRY_RUN && (await serverIsRunning()) && !has('--force')) {
    console.error(
      '\nThe server is running, and it would overwrite this sync from its own\n' +
        'in-memory copy on its next write. Stop it first, sync, then start it again:\n\n' +
        '  (stop the server)\n' +
        '  npm run sync -- --mirror-images\n' +
        '  npm start\n\n' +
        'Use --force only if you know the server is idle.\n'
    );
    process.exit(1);
  }

  const db = fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) : {};

  const results = [];
  for (const name of ENTITIES) {
    process.stdout.write(`  ${name.padEnd(24)}`);
    const result = await fetchEntity(name);
    if (result.error) {
      console.log(`— ${result.error}`);
      results.push({ name, skipped: result.error });
      continue;
    }
    const was = Array.isArray(db[name]) ? db[name].length : 0;
    console.log(`${String(result.rows.length).padStart(5)} rows   (local had ${was})`);
    results.push({ name, rows: result.rows, was });
  }

  if (MIRROR && !DRY_RUN) {
    console.log('\nMirroring images into server/uploads …');
    for (const r of results) {
      if (!r.rows?.length) continue;
      const n = await mirrorRowImages(r.rows);
      if (n) console.log(`  ${r.name}: ${n} image(s)`);
    }
  }

  if (DRY_RUN) {
    console.log('\nDry run complete — re-run without --dry-run to write.\n');
    return;
  }

  // Replace whole collections; leave local-only keys (accounts, sessions,
  // page-view log) untouched.
  let written = 0;
  for (const r of results) {
    if (!r.rows) continue;
    db[r.name] = orderForApp(r.name, r.rows);
    written += r.rows.length;
  }

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);

  console.log(`\nWrote ${written} rows into server/data/db.json.`);
  console.log('Restart the server (or it will pick them up on next boot).\n');
}

main().catch((err) => {
  console.error('\nSync failed:', err.message);
  process.exit(1);
});
