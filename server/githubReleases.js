/**
 * One cached call for every GitHub release the site mirrors (nova-*, tcm-v3).
 *
 * GitHub allows 60 unauthenticated API calls an hour per IP. Listing each release tag
 * separately every 10 minutes (5 tags) used half of that on its own, so every mirror shares
 * a single /releases listing, cached for 9 minutes. Asset downloads go through
 * github.com/objects URLs, which don't count against the API limit.
 */
const REPO = process.env.NOVA_REPO || 'dailymeteorology-code/myweatherukwebsite';
const TTL = 9 * 60000;
let cache = { at: 0, byTag: null, pending: null };

export async function releaseAssets(tag) {
  if (cache.byTag && Date.now() - cache.at < TTL) return cache.byTag[tag] || [];
  if (!cache.pending) {
    cache.pending = (async () => {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
        headers: { 'User-Agent': 'MyWeatherUK-site', Accept: 'application/vnd.github+json' },
      });
      if (!r.ok) throw new Error(`GitHub releases ${r.status}${r.status === 403 ? ' (hourly API limit)' : ''}`);
      const byTag = {};
      for (const rel of await r.json()) byTag[rel.tag_name] = rel.assets || [];
      cache = { at: Date.now(), byTag, pending: null };
    })().catch((e) => { cache.pending = null; throw e; });
  }
  await cache.pending;
  return cache.byTag?.[tag] || [];
}
