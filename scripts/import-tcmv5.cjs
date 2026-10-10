const fs = require('fs');
const path = require('path');
const SRC = 'C:/Users/PC/OneDrive/Desktop/MyWeather/ukv-platform/frontend';
const DST = 'C:/Users/PC/OneDrive/Desktop/MyWeather/myweatheruk-selfhost/public/tcm-v5-app';
const V5_ORIGIN = process.env.V5_ORIGIN || 'http://127.0.0.1:8000';

/* OneDrive holds handles on files it is syncing, so a recursive delete here
   fails with EPERM often enough to matter. It is only a tidy-up — every file
   below is written unconditionally — so a failure is logged and stepped over
   rather than taking the import down with it. */
try {
  fs.rmSync(DST, { recursive: true, force: true });
} catch (err) {
  console.warn(`could not clear ${DST} (${err.code}); overwriting in place`);
}
fs.mkdirSync(path.join(DST, 'assets'), { recursive: true });

const NOTE = `<!-- Ported from ukv-platform/frontend by scripts/import-tcmv5.
     Two edits only: /api/ now points at the V5 service directly, and /assets/
     points at the copy alongside this file. Nothing else is changed. -->\n`;

/* /api/ -> the V5 service itself. The viewer is a client for that backend; it
   is not re-served through this site's API, it just talks to V5 where V5 is.
   /assets/ -> the copies next to this file, since the V5 static mount is not
   here. */
const rewrite = (s) => s
  .replace(/(["'`])\/api\//g, `$1${V5_ORIGIN}/api/`)
  .replace(/(["'`])\/assets\//g, '$1/tcm-v5-app/assets/');

for (const f of ['index.html', 'overlay.html', 'graphic.html']) {
  const from = path.join(SRC, f);
  if (!fs.existsSync(from)) continue;
  const before = fs.readFileSync(from, 'utf8');
  const n = (before.match(/(["'`])\/(api|assets)\//g) || []).length;
  fs.writeFileSync(path.join(DST, f), NOTE + rewrite(before));
  console.log(`${f}: ${n} paths repointed`);
}
for (const a of fs.readdirSync(path.join(SRC, 'assets'))) {
  fs.copyFileSync(path.join(SRC, 'assets', a), path.join(DST, 'assets', a));
}

/* The map-first layout, the drawer and the fullscreen control live in their own
   two files and are injected here rather than edited into the ported HTML.
   That way re-running this script re-ports whatever the platform's frontend has
   become and the changes land on top of the new copy instead of being wiped by
   it. */
const HERE = __dirname;
for (const f of ['tcmv5-enhance.css', 'tcmv5-enhance.js']) {
  fs.copyFileSync(path.join(HERE, f), path.join(DST, f));
}
const indexFile = path.join(DST, 'index.html');
let html = fs.readFileSync(indexFile, 'utf8');
const inject =
  '\n<link rel="stylesheet" href="/tcm-v5-app/tcmv5-enhance.css">\n' +
  '<script defer src="/tcm-v5-app/tcmv5-enhance.js"></script>\n';
if (html.includes('</body>')) html = html.replace('</body>', `${inject}</body>`);
else html += inject;
fs.writeFileSync(indexFile, html);
console.log('enhancements injected into index.html');
console.log('assets:', fs.readdirSync(path.join(DST, 'assets')).join(', '));
console.log('V5 origin:', V5_ORIGIN);
