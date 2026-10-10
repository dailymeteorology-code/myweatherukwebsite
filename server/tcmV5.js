/**
 * TCM V5 PRODUCTS, SERVED FROM DISK
 *
 * TCM V5 lives in `ukv-platform/` as a Python service. It is not run as part of
 * this site and the site does not call it: what it produces is a bundle per
 * forecast cycle — a manifest describing the cycle and a `products.json`
 * holding the forecast itself — and those bundles are copied in under
 * `server/data/tcm-v5/`. That keeps the website a website. Nothing here starts
 * a Python process, needs the Met Office key, or fails because a model run is
 * late; the worst that happens is the newest bundle is old, which the manifest
 * says plainly and the page can show.
 *
 * A bundle carries its own honesty. `status` is one of ready / published /
 * failed, `degraded` says whether the cycle ran with models missing, and
 * `degraded_because` lists each one and why. None of that is decoration —
 * every bundle currently on disk ran degraded, so a page that showed the
 * numbers without that context would be overstating them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, 'data', 'tcm-v5');
const PRODUCTS = path.join(ROOT, 'products');
const MANIFESTS = path.join(ROOT, 'manifests');

/** A forecast id is a directory name; never let one escape the bundle root. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,120}$/;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Every cycle on disk, newest first.
 *
 * Sorted by the cycle the forecast is FOR, not by file time: bundles are copied
 * in as a batch, so their timestamps say when they were copied and nothing
 * about which forecast is the most recent.
 */
export function listCycles() {
  if (!fs.existsSync(MANIFESTS)) return [];
  return fs.readdirSync(MANIFESTS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const m = readJson(path.join(MANIFESTS, f));
      if (!m?.forecast_id) return null;
      return {
        forecast_id: m.forecast_id,
        cycle: m.cycle ?? null,
        status: m.status ?? 'unknown',
        degraded: m.degraded === true,
        degraded_because: Array.isArray(m.degraded_because) ? m.degraded_because : [],
        // Only a bundle with a products.json can actually be opened.
        has_products: fs.existsSync(path.join(PRODUCTS, m.forecast_id, 'products.json')),
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.cycle).localeCompare(String(a.cycle)));
}

/** The newest cycle that both published and has something to show. */
export function newestUsable() {
  return listCycles().find((c) => c.status === 'published' && c.has_products) || null;
}

/** One bundle's forecast payload, or null. */
export function readProduct(forecastId) {
  if (!SAFE_ID.test(forecastId)) return null;
  const file = path.join(PRODUCTS, forecastId, 'products.json');
  if (!file.startsWith(PRODUCTS)) return null;
  return readJson(file);
}

export function mountTcmV5(app) {
  /* The catalogue: what cycles exist, and how much each should be trusted. */
  app.get('/api/tcm-v5/cycles', (req, res) => {
    const cycles = listCycles();
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ cycles, newest_usable: newestUsable()?.forecast_id ?? null });
  });

  /* One cycle. `latest` resolves to the newest published bundle, so the page
     does not have to know an id to show something. */
  app.get('/api/tcm-v5/product/:id', (req, res) => {
    const id = req.params.id === 'latest' ? newestUsable()?.forecast_id : req.params.id;
    if (!id) return res.status(404).json({ error: 'no published TCM V5 cycle available' });

    const payload = readProduct(id);
    if (!payload) return res.status(404).json({ error: `no bundle for ${id}` });

    const meta = listCycles().find((c) => c.forecast_id === id) || null;
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ forecast_id: id, manifest: meta, products: payload });
  });
}

export default { listCycles, newestUsable, readProduct, mountTcmV5 };
