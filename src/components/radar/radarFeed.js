/* ════════════════════════════════════════════════════════════════════════════
   The Radar tab's frames, fetched ahead and kept while the app is open (17 Nov 2026, the user: "make the radar
   loading significantly faster, to a point it is basically instant").

   A few seconds after the app opens on a phone, the list of radar scans and the newest scan (with its
   precipitation type, about 210 KB) are fetched in the background, so the Radar tab shows the newest scan the
   moment it is first opened. The rest of the last three hours, newest first, and the newest UKV run's next nine
   hours come when the tab is opened, six at a time, each usable as soon as it is in. The forecast run is looked
   up beside the radar's scans, not before them. Nothing is turned into a picture here: the tab draws a frame
   from its bytes when it is shown (lib/ukRadar drawRadarFrame).

   The data are the Location page's radar (server/locationWeather.js /api/location/radar and its frames); the
   forecast is the newest UKV run Model Data has made the rain for (/api/modeldata/catalog).
   ════════════════════════════════════════════════════════════════════════════ */
import { parseRadarCrop, radarStamp } from '@/lib/ukRadar';
import { runTag } from '@/lib/modelViewer';

const AHEAD_H = 9;                    // the forecast's reach after the newest scan, hours
const INDEX_FRESH = 60e3;             // a list of scans younger than this is used as it is
const UKV_FRESH = 5 * 60e3;           // the forecast run is looked up again after this
const PARALLEL = 6;

let index = null, indexAt = 0, indexP = null, indexTried = false;
let ukv = null, ukvAt = 0, ukvFrom = 0, ukvP = null, ukvLooked = false;
const bytes = new Map();              // url -> crop when in, null when it failed, a promise while on its way
const readyOnce = new Set();          // frames that have been ready: they stay ready (no flicker on a refresh)
let queue = [], running = 0;
const subs = new Set();
let snap = { frames: [], run: null, state: 'loading' };
let emitPending = false;

/* The forecast part: the newest UKV run whose rain Model Data has made for the hours after the radar (three runs
   tried, newest first), each step with whether its precipitation type is made too. Null when none has it yet.
   Asking for a run's status has Model Data make that layer if it is not made, so the first run that has enough
   ends the search. */
async function newestUkv(fromMs) {
  const cat = await fetch('/api/modeldata/catalog').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const runs = (cat?.models || []).find((m) => m.id === 'ukv')?.runs || [];
  for (const r of runs.slice(0, 3)) {
    const tag = runTag(r.run), runMs = Date.parse(r.run);
    const first = Math.max(0, Math.round((fromMs - runMs) / 36e5));
    const st = await fetch(`/api/modeldata/frames/ukv/${tag}/precip_rate/status?first=${first}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    const done = new Set(st?.done || []);
    const out = (r.steps || []).map((h) => ({ h, t: runMs + h * 36e5 }))
      .filter(({ h, t }) => t > fromMs && t <= fromMs + AHEAD_H * 36e5 && done.has(h))
      .map(({ h, t }) => ({ run: tag, h, valid: new Date(t).toISOString() }));
    if (out.length >= 3) {
      const pt = await fetch(`/api/modeldata/frames/ukv/${tag}/ptype/status?first=${first}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      const typed = new Set(pt?.done || []);
      return { run: { tag, runMs, steps: r.steps || [] }, future: out.map((f) => ({ ...f, typed: typed.has(f.h) })) };
    }
  }
  return null;
}

const newestPast = () => {
  const past = index?.past || [];
  return past.length ? Date.parse(past[past.length - 1]) : Date.now();
};

/* every frame the timeline has: the radar's scans, then the forecast's hours */
function listFrames() {
  const at = 'scope=uk';
  const typed = new Set(index?.pastTyped || []);
  const past = (index?.past || []).map((t) => ({
    kind: 'radar', valid: Date.parse(t), url: `/api/location/radar/frame?src=radar&t=${radarStamp(t)}&${at}&km=1`,
    typeUrl: typed.has(t) ? `/api/location/radar/frame?src=radar&t=${radarStamp(t)}&kind=type&${at}` : null,
  }));
  /* the point cubes' run (in the list of scans) only when Model Data has none: it can be a day old */
  const fut = ukv?.future || (ukvLooked ? index?.future || [] : []);
  const future = fut.map((f) => ({
    kind: 'ukv', valid: Date.parse(f.valid), run: f.run, url: `/api/location/radar/frame?src=ukv&run=${f.run}&h=${f.h}&${at}`,
    typeUrl: f.typed ? `/api/location/radar/frame?src=ukv&run=${f.run}&h=${f.h}&kind=type&${at}` : null,
  }));
  return [...past, ...future];
}

/* A frame is ready when its rain is in and its type is not still on its way (a type that failed, or that comes
   later, leaves the rain in the radar's own colours until it is in). One whose rain failed is left out. */
const isIn = (v) => v != null && !(v instanceof Promise);
function build() {
  const frames = [];
  for (const f of listFrames()) {
    const crop = bytes.get(f.url);
    if (crop === null) continue;
    const t = f.typeUrl ? bytes.get(f.typeUrl) : undefined;
    const ready = isIn(crop) && (readyOnce.has(f.url) || !(t instanceof Promise));
    if (ready) readyOnce.add(f.url);
    frames.push({ ...f, crop: isIn(crop) ? crop : null, tcrop: isIn(t) ? t : null, ready });
  }
  const settled = indexTried && !indexP && (ukvLooked || !index) && !running && !queue.length;
  return {
    frames,
    run: ukv?.run || (ukvLooked && index?.future?.[0] ? { tag: index.future[0].run, runMs: null, steps: [] } : null),
    state: frames.some((f) => f.ready) ? 'ready' : settled ? 'none' : 'loading',
  };
}
function changed() {
  if (emitPending) return;
  emitPending = true;
  /* the frames that come in together are told together */
  Promise.resolve().then(() => {
    emitPending = false;
    snap = build();
    subs.forEach((fn) => fn(snap));
  });
}

/* fetched six at a time; `first` puts them at the front of the line */
function want(urls, first = false) {
  const fresh = urls.filter((u) => u && !bytes.has(u));
  queue = queue.filter((u) => !fresh.includes(u));
  queue = first ? [...fresh, ...queue] : [...queue, ...fresh];
  pump();
}
function pump() {
  while (running < PARALLEL && queue.length) {
    const url = queue.shift();
    if (bytes.has(url)) continue;
    running++;
    const p = fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? parseRadarCrop(b) : null)).catch(() => null)
      .then((crop) => {
        running--;
        if (bytes.get(url) === p) bytes.set(url, crop);      // unless let go meanwhile
        changed();
        pump();
      });
    bytes.set(url, p);
  }
}

/* the list of scans, read again when older than a minute (or when asked) */
function readIndex(force = false) {
  if (indexP) return indexP;
  if (!force && index && Date.now() - indexAt < INDEX_FRESH) return Promise.resolve(index);
  indexP = fetch('/api/location/radar').then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((ix) => { index = ix; indexAt = Date.now(); return ix; })
    .catch(() => index)
    .finally(() => { indexP = null; indexTried = true; changed(); });
  return indexP;
}
/* the forecast's run: looked up again for a new newest scan, or after five minutes */
function lookUkv() {
  const from = newestPast();
  if (ukvP) return ukvP;
  if (ukvLooked && from === ukvFrom && Date.now() - ukvAt < UKV_FRESH) return Promise.resolve(ukv);
  ukvP = newestUkv(from).catch(() => null).then((u) => {
    ukv = u || ukv;
    ukvAt = Date.now(); ukvFrom = from; ukvLooked = true; ukvP = null;
    changed();
    return ukv;
  });
  return ukvP;
}
/* Crops no longer on the timeline are let go, and rain that failed may be tried again. A type that failed is
   not asked for again (it is usually one the analysis has not made yet; the next scan's will be there). */
function tidy() {
  const frames = listFrames();
  const keep = new Set(frames.flatMap((f) => [f.url, f.typeUrl]).filter(Boolean));
  const rain = new Set(frames.map((f) => f.url));
  for (const [u, v] of bytes) if (!keep.has(u) || (v === null && rain.has(u))) bytes.delete(u);
  for (const u of readyOnce) if (!rain.has(u)) readyOnce.delete(u);
  queue = queue.filter((u) => keep.has(u));
}

/** The newest scan and its type, fetched quietly ahead of the Radar tab (once the app has settled). */
export function prefetchRadar() {
  readIndex().then(() => {
    const past = listFrames().filter((f) => f.kind === 'radar');
    const last = past[past.length - 1];
    if (last) want([last.url, last.typeUrl], true);
  });
}

/** Everything the timeline needs: the newest scan first, then the older ones newest first, and the forecast's
    hours as soon as its run is known. `force` reads the list of scans again however young it is. */
export function loadRadar(force = false) {
  readIndex(force).then(() => {
    tidy();
    const past = listFrames().filter((f) => f.kind === 'radar').reverse();
    want(past.flatMap((f) => [f.url, f.typeUrl]), true);
    changed();
    lookUkv().then(() => {
      tidy();
      want(listFrames().filter((f) => f.kind === 'ukv').flatMap((f) => [f.url, f.typeUrl]));
      changed();
    });
  });
}

/** Told of every change (frames in, a new scan, the forecast's run); also given the frames as they are now. */
export function subscribeRadar(fn) {
  subs.add(fn);
  snap = build();
  fn(snap);
  return () => subs.delete(fn);
}
