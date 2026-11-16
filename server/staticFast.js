/* The site's own text files, compressed and kept (16 Nov 2026, Model Data's first-load speed).

   express.static sent the app's 4.8 MB script as it is, with max-age=0, so every visit downloaded it
   (or at least asked about it) again. Here a script, style sheet, JSON or SVG file goes out
   compressed, Brotli where the browser takes it and gzip otherwise (the script ~1 MB), compressed once
   and kept in memory until the file changes. Files under /assets/ are named by their contents, so a
   browser may keep them for a year without asking. Anything else falls through to express.static.
   Compressing runs in Node's thread pool, never on the event loop. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const brotli = promisify(zlib.brotliCompress), gzip = promisify(zlib.gzip);
const TYPES = {
  '.js': 'application/javascript; charset=UTF-8', '.mjs': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8', '.json': 'application/json; charset=UTF-8', '.geojson': 'application/geo+json',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=UTF-8', '.webmanifest': 'application/manifest+json', '.map': 'application/json; charset=UTF-8',
};
const SMALLEST = 1024;                                  // smaller than this is not worth compressing
const ROOM = 96e6;                                      // memory for the compressed copies
const kept = new Map();                                 // file|encoding -> { body, tag }, oldest use first
const making = new Map();                               // the same, while being compressed
let used = 0;

function squeeze(file, enc, tag) {
  const key = `${file}|${enc}`;
  const hit = kept.get(key);
  if (hit && hit.tag === tag) { kept.delete(key); kept.set(key, hit); return Promise.resolve(hit); }
  const k2 = `${key}|${tag}`;
  if (making.has(k2)) return making.get(k2);
  const p = fs.promises.readFile(file)
    .then((raw) => (enc === 'br'
      ? brotli(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
      : gzip(raw, { level: 6 })))
    .then((body) => {
      const old = kept.get(key);
      if (old) { kept.delete(key); used -= old.body.length; }
      const got = { body, tag };
      kept.set(key, got);
      used += body.length;
      while (used > ROOM && kept.size > 1) { const [k, v] = kept.entries().next().value; kept.delete(k); used -= v.body.length; }
      return got;
    })
    .finally(() => making.delete(k2));
  making.set(k2, p);
  return p;
}

export function fastStatic(root) {
  const base = path.resolve(root);
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const type = TYPES[path.extname(req.path).toLowerCase()];
    if (!type) return next();
    const accept = String(req.headers['accept-encoding'] || '');
    const enc = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
    if (!enc) return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    const file = path.join(base, rel);
    if (!file.startsWith(base + path.sep)) return next();
    let st;
    try { st = await fs.promises.stat(file); } catch { return next(); }
    if (!st.isFile() || st.size < SMALLEST) return next();
    const tag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-${enc}"`;
    const headers = () => {
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Cache-Control', rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=0');
      res.setHeader('ETag', tag);
    };
    if (req.headers['if-none-match'] === tag) { headers(); return res.status(304).end(); }
    let got;
    try { got = await squeeze(file, enc, tag); } catch { return next(); }
    headers();
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Encoding', enc);
    res.setHeader('Content-Length', got.body.length);
    return req.method === 'HEAD' ? res.end() : res.end(got.body);
  };
}

/** express.static's own headers for the rest: anything under /assets/ (fonts, images) is named by its
    contents too, so it is kept for a year */
export const assetHeaders = (res, file) => {
  if (/[\\/]assets[\\/]/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
};
