/**
 * Export the site's PUBLIC content as static files so the GitHub → Netlify
 * build (which has no server and no database) shows the real logo, banner,
 * social links, news and so on.
 *
 *   npm run export:public
 *
 * Writes public/static-data/*.json and copies every /uploads/… file those
 * rows reference into public/uploads/, so the same URLs work on Netlify.
 *
 * SAFETY: SiteSettings is exported through a WHITELIST (it also holds API
 * keys). Every other row is scrubbed of any field whose name looks like a
 * secret or personal data. Run it, check `git diff`, then commit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalogue, lightPayload, fullRecord } from './scenarios/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const DB = path.join(here, 'data/db.json');
const UPLOADS = path.join(here, 'uploads');
const OUT = path.join(ROOT, 'public/static-data');
const PUB_UPLOADS = path.join(ROOT, 'public/uploads');

const SETTINGS_FIELDS = [
  'id', 'site_name', 'version', 'description', 'logo_url', 'banner_url', 'tcm_logo_url',
  'twitter_url', 'facebook_url', 'instagram_url', 'youtube_url', 'discord_url', 'buymeacoffee_url',
  'site_disabled', 'disabled_title', 'disabled_message', 'countdown_enabled', 'countdown_title',
  'countdown_description', 'countdown_target', 'countdown_display', 'location_search_enabled',
  'storm_text', 'sunny_text', 'created_date', 'updated_date',
];
const PUBLIC_ENTITIES = ['NewsArticle', 'Announcement', 'AppUpdate', 'MenuItemConfig', 'PublishedFeatures'];
const SECRET = /key|token|secret|password|passcode|access_code|email|phone|ip_?address|created_by|session/i;

const scrub = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !SECRET.test(k)));

if (!fs.existsSync(DB)) { console.log('No local database — nothing to export (fine on Netlify).'); process.exit(0); }
const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
const ent = db.entities || db;
fs.mkdirSync(OUT, { recursive: true });

const written = {};
const settings = (ent.SiteSettings || []).slice(0, 1).map((r) => Object.fromEntries(SETTINGS_FIELDS.filter((k) => k in r).map((k) => [k, r[k]])));
written.SiteSettings = settings;
for (const name of PUBLIC_ENTITIES) if (Array.isArray(ent[name])) written[name] = ent[name].map(scrub);
for (const [name, rows] of Object.entries(written)) fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(rows));

// Copy referenced uploads (images only) so /uploads/... works on Netlify.
const refs = new Set(JSON.stringify(written).match(/\/uploads\/[A-Za-z0-9._-]+/g) || []);
fs.mkdirSync(PUB_UPLOADS, { recursive: true });
let copied = 0;
for (const ref of refs) {
  const file = ref.slice('/uploads/'.length);
  if (!/\.(png|jpe?g|jfif|gif|webp|svg|avif)$/i.test(file)) continue;
  const src = path.join(UPLOADS, file);
  if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(PUB_UPLOADS, file)); copied += 1; }
}

// Weather Scenarios: catalogue, boundaries and full records.
buildCatalogue();
fs.writeFileSync(path.join(OUT, 'scenarios-catalogue.json'), lightPayload().json);
const items = {};
for (const s of JSON.parse(lightPayload().json).scenarios) items[s.id] = fullRecord(s.id);
fs.writeFileSync(path.join(OUT, 'scenarios-items.json'), JSON.stringify(items));
for (const f of ['regions.geo.json', 'context.geo.json']) fs.copyFileSync(path.join(here, 'data/scenarios', f), path.join(OUT, f));

console.log(`Exported ${Object.entries(written).map(([k, v]) => `${k} (${v.length})`).join(', ')}; ${copied} images; scenario data.`);
