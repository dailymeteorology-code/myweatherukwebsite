/* Web-sized copies of uploaded images: GET /api/img/:file?w=1200
 *
 * Forecast graphics are uploaded at full print size (a 5120 px, 12 MB JPEG is normal), and the
 * home page used to load that whole file for a card a few hundred pixels wide. A copy is made
 * once per width (tools/img/resize.py, Pillow, WebP), kept on the data drive, and served with a
 * year-long cache: an upload's name is unique, so a copy never goes stale. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveEnsPython } from './pastFuture/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, '..', 'tools', 'img', 'resize.py');
const CACHE = fs.existsSync('D:/') ? 'D:/MyWeatherUK-data/img-cache' : path.join(here, 'data', 'img-cache');
const WIDTHS = [480, 800, 1200, 1600, 2400];
const FILE_RE = /^[\w.-]+\.(jpe?g|png|webp)$/i;
const making = new Map();                                     // one conversion per copy at a time

function make(src, dst, w) {
  if (!making.has(dst)) {
    const py = resolveEnsPython();
    making.set(dst, new Promise((resolve, reject) => {
      const tmp = `${dst}.${process.pid}.tmp`;
      const child = spawn(py.cmd, [SCRIPT, src, tmp, String(w)], { env: { ...process.env, ...py.env }, windowsHide: true });
      let err = '';
      child.stderr.on('data', (d) => { err = (err + d).slice(-500); });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code) { fs.rmSync(tmp, { force: true }); reject(new Error(err || `resize exited ${code}`)); return; }
        try { fs.renameSync(tmp, dst); resolve(); } catch (e) { reject(e); }
      });
    }).finally(() => making.delete(dst)));
  }
  return making.get(dst);
}

/** Make the usual copies of a new upload in the background, one after another, so nobody waits
    for them on first view. */
export function warmImageSizes(uploadDir, file) {
  if (!FILE_RE.test(file)) return;
  const src = path.join(uploadDir, file);
  (async () => {
    for (const w of [800, 1200, 1600, 480, 2400]) {
      const dst = path.join(CACHE, `${file}.${w}.webp`);
      if (!fs.existsSync(dst)) await make(src, dst, w).catch(() => {});
    }
  })();
}

export function mountImageSizes(app, uploadDir) {
  fs.mkdirSync(CACHE, { recursive: true });
  app.get('/api/img/:file', async (req, res) => {
    const { file } = req.params;
    if (!FILE_RE.test(file)) return res.status(400).end();
    const src = path.join(uploadDir, file);
    if (!fs.existsSync(src)) return res.status(404).end();
    const asked = Number(req.query.w) || 1200;
    const w = WIDTHS.find((x) => x >= asked) || WIDTHS[WIDTHS.length - 1];
    const dst = path.join(CACHE, `${file}.${w}.webp`);
    try {
      if (!fs.existsSync(dst)) await make(src, dst, w);
      res.set({ 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Type': 'image/webp' });
      fs.createReadStream(dst).pipe(res);
    } catch {
      res.redirect(302, `/uploads/${encodeURIComponent(file)}`);          // the original still works
    }
  });
}
