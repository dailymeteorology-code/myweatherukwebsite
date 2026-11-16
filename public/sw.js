/* MyWeatherUK's service worker (Location Weather "Add to your home screen", 16 Nov 2026).

   Deliberately small: it answers two kinds of request and leaves every other one to the network.
     • Opening the Location Weather page (/LocationWeather...): the network first, as without a worker;
       with no network, the copy of the page saved last time, so the installed app still opens offline
       (the page then shows the forecast it saved for the place, with its age).
     • The site's built scripts and styles (/assets/*.js, *.css): their names change with every build,
       so a saved copy is never out of date. Saved the first time they load, then served from the save;
       the oldest are dropped past 80.
   Registered by the Location page only (src/lib/location/app.js), in production builds.
   To retire it: replace this file with one that calls self.registration.unregister(). */
const SHELL = 'mwuk-shell-v1';
const ASSETS = 'mwuk-assets-v1';
const MAX_ASSETS = 80;
const PAGE = '/LocationWeather';
const isAsset = (path) => path.startsWith('/assets/') && /\.(js|css)$/.test(path);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    /* the page and the files it starts with, so the first visit already works offline */
    try {
      const res = await fetch(PAGE, { cache: 'no-store' });
      if (res.ok) {
        const html = await res.clone().text();
        await (await caches.open(SHELL)).put(PAGE, res);
        const files = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
        const c = await caches.open(ASSETS);
        await Promise.all(files.map((f) => c.add(f).catch(() => {})));
      }
    } catch { /* offline while installing: saved on the next visit */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('mwuk-') && k !== SHELL && k !== ASSETS) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate' && /^\/locationweather\/?$/i.test(url.pathname)) event.respondWith(page(req));
  else if (isAsset(url.pathname)) event.respondWith(asset(req));
});

async function page(req) {
  try {
    const res = await fetch(req);
    if (res.status === 200) {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put(PAGE, copy)).catch(() => {});
    }
    return res;
  } catch (err) {
    const saved = await (await caches.open(SHELL)).match(PAGE, { ignoreVary: true });
    if (saved) return saved;
    throw err;
  }
}

/* the saved copies are looked up by address alone: a module script asks with an Origin header and the
   server answers "Vary: Origin" (and "Vary: Accept-Encoding" when compressed), which would otherwise
   never match the copy saved at install; a hashed file is the same file whichever way it was asked for */
async function asset(req) {
  const c = await caches.open(ASSETS);
  const saved = await c.match(req, { ignoreVary: true });
  if (saved) return saved;
  const res = await fetch(req);
  if (res.status === 200 && res.type === 'basic') {
    await c.put(req, res.clone()).catch(() => {});
    trim(c);
  }
  return res;
}

async function trim(c) {
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await c.delete(k);
}
