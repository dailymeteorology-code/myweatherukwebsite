#!/usr/bin/env node
/* MyWeatherUK's version number, 5.##.### (numbers only), kept in version.json and listed in VERSIONS.md.

     node scripts/version.mjs                            the current version
     node scripts/version.mjs minor "What changed" [chat] a big-ish update (a new page, model, or a rebuild or
                                                         redesign of a section): 5.50.003 -> 5.51.000
     node scripts/version.mjs patch "What changed" [chat] a smaller patch (a fix, tweak, polish, speed, work
                                                         behind the scenes): 5.50.003 -> 5.50.004
     node scripts/version.mjs tag                        after committing: tag that commit with the version

   Every chat that saves the site bumps the version in the same commit, then tags it and pushes the tag
   (git push origin main <version>: never --tags, the release tags are moved by the cloud runs). The site shows the version in the corner of every page (src/App.jsx,
   from version.json at build time: vite.config.js). */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_FILE = path.join(ROOT, 'version.json');
const HISTORY = path.join(ROOT, 'VERSIONS.md');
const PACKAGE = path.join(ROOT, 'package.json');

const show = (v) => `${v.major}.${String(v.minor).padStart(2, '0')}.${String(v.patch).padStart(3, '0')}`;
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const today = () => new Date().toISOString().slice(0, 10);

function read() {
  const v = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  return { major: v.major, minor: v.minor, patch: v.patch };
}

/* the history's rows saved without their commit get it from the version's tag, once tagged */
function backfill(text) {
  return text.replace(/^\| (\d\.\d{2}\.\d{3}) \| ([^|]*) \| ([^|]*) \| — \|/gm, (row, ver, date, kind) => {
    try { return `| ${ver} | ${date} | ${kind} | ${git('rev-list', '-n', '1', '--abbrev-commit', ver)} |`; } catch { return row; }
  });
}

const [cmd, title = '', chat = ''] = process.argv.slice(2);
const now = read();

if (!cmd) {
  console.log(show(now));
} else if (cmd === 'minor' || cmd === 'patch') {
  if (!title.trim()) { console.error('Say what changed: node scripts/version.mjs ' + cmd + ' "What changed"'); process.exit(2); }
  const next = cmd === 'minor' ? { ...now, minor: now.minor + 1, patch: 0 } : { ...now, patch: now.patch + 1 };
  if (next.minor > 99 || next.patch > 999) { console.error(`${show(next)} does not fit 5.##.###: time for the next main version`); process.exit(2); }
  const ver = show(next);
  fs.writeFileSync(VERSION_FILE, `${JSON.stringify({ version: ver, ...next, date: today() }, null, 2)}\n`);
  /* package.json (and its lockfile) carry the same version the way npm wants it (no leading zeros) */
  const npmVer = `${next.major}.${next.minor}.${next.patch}`;
  const pkg = fs.readFileSync(PACKAGE, 'utf8');
  fs.writeFileSync(PACKAGE, pkg.replace(/"version":\s*"[^"]*"/, `"version": "${npmVer}"`));
  const LOCK = path.join(ROOT, 'package-lock.json');
  if (fs.existsSync(LOCK)) {
    const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    lock.version = npmVer;
    if (lock.packages?.['']) lock.packages[''].version = npmVer;
    fs.writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
  }
  /* the history: the new version first, under the table's header */
  const cell = (s) => String(s).replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
  const lines = backfill(fs.readFileSync(HISTORY, 'utf8')).split('\n');
  const at = lines.findIndex((l) => l.startsWith('|---'));
  lines.splice(at + 1, 0, `| ${ver} | ${today()} | ${cmd === 'minor' ? 'Update' : 'Patch'} | — | ${cell(title)} | ${cell(chat) || '—'} |`);
  fs.writeFileSync(HISTORY, lines.join('\n'));
  console.log(ver);
} else if (cmd === 'tag') {
  const ver = show(now);
  try { git('rev-parse', '-q', '--verify', `refs/tags/${ver}`); console.error(`${ver} is already tagged`); process.exit(1); } catch { /* not yet: tag it */ }
  /* only the save that carries this version: a commit that failed must not leave its number on the one before */
  let saved = null;
  try { saved = JSON.parse(git('show', 'HEAD:version.json')).version; } catch { /* no version.json in it */ }
  if (saved !== ver) { console.error(`The last save is ${saved || 'unnumbered'}, not ${ver}: commit first, then tag`); process.exit(1); }
  git('tag', ver);
  console.log(`${ver} tagged on ${git('rev-parse', '--short', 'HEAD')}: git push origin main ${ver}`);
} else {
  console.error('node scripts/version.mjs [minor "What changed" | patch "What changed" | tag]');
  process.exit(2);
}
