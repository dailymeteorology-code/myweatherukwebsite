import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * pollBlitzortungLightning
 * ----------------------------------------------------------------------------
 * Server-side 24/7 lightning ingestion. Connects to Blitzortung's public
 * WebSocket for ~50 seconds, captures strikes inside the Europe bbox (covers
 * both UK & Ireland and continental Europe), and bulk-inserts new strikes
 * into the LightningStrike entity. Runs every 5 minutes via the
 * "Blitzortung Lightning Poll (1 min)" scheduled automation.
 *
 * This guarantees lightning data is collected even when no user has the site
 * open — strikes persist in the database and are loaded when users visit.
 */

// Wider bbox: includes UK, Ireland and continental Europe
const EU_BBOX = { latMin: 34.0, latMax: 72.0, lonMin: -25.0, lonMax: 45.0 };
// The Render worker is an ALWAYS-ON process that captures Blitzortung strikes
// 24/7 with no gaps and exposes them at /strikes/recent. It is the authoritative
// real-time source. This scheduled function's PRIMARY job is simply to persist
// the worker's continuous catch into the shared DB so it accumulates the full
// day even when no browser is open. A short direct-WebSocket listen runs as a
// SECONDARY backstop in case the worker is briefly unreachable (Render cold
// start, redeploy, etc.). Strikes from both are merged and deduped before insert.
const RENDER_WORKER_RECENT = 'https://blitzortungworker-3.onrender.com/strikes/recent';
// Keep the direct-WebSocket backstop SHORT so the function never approaches the
// ~150s hard timeout (a longer listen previously crashed with a 502 before any
// insert ran, which after repeated failures disabled the scheduled automation).
// The worker pull is what guarantees coverage; the socket is just a bonus.
const POLL_DURATION_MS = 45_000;
// Blitzortung shards its live feed across servers by region — a single server
// only broadcasts a partial geographic slice. Connect to the full ws1–ws8 range
// so every regional slice — including the UK — is captured. Deduped before insert.
const SERVERS = [
  'wss://ws1.blitzortung.org',
  'wss://ws2.blitzortung.org',
  'wss://ws3.blitzortung.org',
  'wss://ws7.blitzortung.org',
  'wss://ws8.blitzortung.org',
];

// Pull the always-on worker's rolling buffer. This is the gapless primary feed.
async function pullWorkerRecent() {
  try {
    const r = await fetch(RENDER_WORKER_RECENT, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return [];
    const arr = await r.json();
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const s of arr) {
      let lat = Number(s.lat), lon = Number(s.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (Math.abs(lat) > 90)  lat = lat / 1e7;
      if (Math.abs(lon) > 180) lon = lon / 1e7;
      // Normalise time units: ns (>1e15) → ms; s (<1e12) → ms; ms as-is.
      let t = Number(s.time ?? s.t ?? s.timestamp);
      if (!Number.isFinite(t)) continue;
      if (t > 1e15) t = Math.floor(t / 1e6);
      else if (t < 1e12) t = Math.floor(t * 1000);
      out.push({ lat, lon, time: t, amp: s.amp || s.mamp || 0 });
    }
    return out;
  } catch {
    return [];
  }
}

// LZW decode from blitzortung.org's official client
function blitzortungDecode(raw) {
  try {
    const d = Array.from(raw);
    if (!d.length) return null;
    const e = {};
    let c = d[0], f = c;
    const g = [c];
    let h = 256, o = h;
    for (let i = 1; i < d.length; i++) {
      const code = d[i].charCodeAt(0);
      let a;
      if (h > code) a = d[i];
      else if (e[code] !== undefined) a = e[code];
      else a = f + c;
      g.push(a);
      c = a[0];
      e[o] = f + c;
      o++;
      f = a;
    }
    return JSON.parse(g.join(''));
  } catch { return null; }
}

function collectStrikes(serverUrl) {
  return new Promise((resolve) => {
    const collected = [];
    let ws;
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      try { ws?.close(); } catch {}
      resolve(collected);
    };
    try {
      ws = new WebSocket(serverUrl);
    } catch (e) {
      console.error('[pollBlitz] ws construct failed', e?.message);
      resolve([]);
      return;
    }
    const timeout = setTimeout(finish, POLL_DURATION_MS);
    let pingInterval;
    ws.onopen = () => {
      try { ws.send(JSON.stringify({ a: 111 })); } catch {}
      pingInterval = setInterval(() => {
        try { if (ws.readyState === 1) ws.send(JSON.stringify({ a: 111 })); } catch {}
      }, 25_000);
    };
    ws.onmessage = (evt) => {
      if (closed) return;
      let parsed = null;
      try { parsed = JSON.parse(evt.data); } catch {}
      if (!parsed) parsed = blitzortungDecode(evt.data);
      if (!parsed) return;
      const strikes = parsed.strikes || (parsed.lat !== undefined ? [parsed] : null);
      if (!strikes) return;
      for (const s of strikes) {
        let lat = s.lat, lon = s.lon;
        if (Math.abs(lat) > 90) lat = lat / 1e7;
        if (Math.abs(lon) > 180) lon = lon / 1e7;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (lat < EU_BBOX.latMin || lat > EU_BBOX.latMax || lon < EU_BBOX.lonMin || lon > EU_BBOX.lonMax) continue;
        const time = s.time
          ? (s.time > 1e12 ? Math.floor(s.time / 1e6) : s.time * 1000)
          : Date.now();
        collected.push({ lat, lon, time, amp: s.mamp || 0 });
      }
    };
    ws.onerror = () => { clearInterval(pingInterval); clearTimeout(timeout); finish(); };
    ws.onclose = () => { clearInterval(pingInterval); clearTimeout(timeout); finish(); };
  });
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  try {
    const base44 = createClientFromRequest(req);
    const body0 = await req.clone().json().catch(() => ({}));
    // Self-chaining: the scheduler fires only every few minutes, but each run is
    // short. Since the always-on worker holds the gapless catch, we chain several
    // back-to-back runs so the worker's /strikes/recent is PERSISTED frequently
    // across the whole scheduler gap — every chained run is ~45-60s, so chaining
    // up to ~5 deep keeps the DB continuously topped up between triggers without
    // ever risking the per-invocation timeout (each run is short and independent).
    // Capped so a single trigger can never spawn a runaway loop.
    const MAX_CHAIN = 5;
    const chain = Number(body0?.chain) || 0;
    if (chain < MAX_CHAIN) {
      base44.functions.invoke('pollBlitzortungLightning', { chain: chain + 1 }).catch(() => {});
    }

    // Connect to ALL Blitzortung servers in parallel for the SECONDARY backstop,
    // AND pull the always-on worker's gapless buffer (PRIMARY) at the same time.
    console.log(`[pollBlitz] worker pull + ${SERVERS.length} server socket backstop (${POLL_DURATION_MS}ms)`);
    const [workerStrikes, perServer] = await Promise.all([
      pullWorkerRecent(),
      Promise.all(SERVERS.map(url => collectStrikes(url).catch(() => []))),
    ]);
    const raw = [...workerStrikes, ...perServer.flat()];
    console.log(`[pollBlitz] worker=${workerStrikes.length} socket=${perServer.map(s => s.length).join('+')} total=${raw.length}`);
    if (!raw.length) {
      return Response.json({ ok: true, saved: 0, collected: 0, worker: 0 });
    }

    // Filter to today's UTC window + build dedup keys
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();
    const nowMs = Date.now();

    const valid = [];
    const seenKeys = new Set();
    for (const s of raw) {
      if (s.lat < EU_BBOX.latMin || s.lat > EU_BBOX.latMax || s.lon < EU_BBOX.lonMin || s.lon > EU_BBOX.lonMax) continue;
      if (s.time < todayStartMs || s.time > nowMs + 60_000) continue;
      const lat = Math.round(s.lat * 10000) / 10000;
      const lon = Math.round(s.lon * 10000) / 10000;
      const dedup_key = `${Math.floor(s.time)}_${lat.toFixed(4)}_${lon.toFixed(4)}`;
      if (seenKeys.has(dedup_key)) continue;
      seenKeys.add(dedup_key);
      valid.push({ lat, lon, time: Math.floor(s.time), amp: s.amp || 0, dedup_key });
    }

    if (!valid.length) {
      return Response.json({ ok: true, saved: 0, collected: raw.length, deduped: 0 });
    }

    // De-dupe against DB. Run the chunk lookups in PARALLEL (not sequentially) so
    // a busy day's dedup phase can't eat the remaining execution budget and crash
    // the insert before it runs. Each chunk is an independent $in query.
    const keys = valid.map(v => v.dedup_key);
    const chunks = [];
    for (let i = 0; i < keys.length; i += 200) chunks.push(keys.slice(i, i + 200));
    const existingKeys = new Set();
    const chunkResults = await Promise.all(chunks.map(chunk =>
      base44.asServiceRole.entities.LightningStrike.filter(
        { dedup_key: { $in: chunk } },
        '-time',
        chunk.length
      ).catch(() => [])
    ));
    for (const res of chunkResults) for (const e of res) existingKeys.add(e.dedup_key);

    const toInsert = valid.filter(v => !existingKeys.has(v.dedup_key));
    if (toInsert.length) {
      // Insert batches in PARALLEL too, for the same timeout-safety reason.
      const batches = [];
      for (let i = 0; i < toInsert.length; i += 500) batches.push(toInsert.slice(i, i + 500));
      await Promise.all(batches.map(b =>
        base44.asServiceRole.entities.LightningStrike.bulkCreate(b).catch(e => {
          console.error('[pollBlitz] bulkCreate batch failed', e?.message);
        })
      ));
    }

    const elapsed = Date.now() - startedAt;
    console.log(`[pollBlitz] saved=${toInsert.length} dupes=${existingKeys.size} worker=${workerStrikes.length} total=${raw.length} elapsed=${elapsed}ms`);

    return Response.json({
      ok: true,
      collected: raw.length,
      fromWorker: workerStrikes.length,
      validToday: valid.length,
      alreadyExisted: existingKeys.size,
      saved: toInsert.length,
      elapsedMs: elapsed,
    });
  } catch (error) {
    console.error('[pollBlitz] ERROR', error?.message, error?.stack);
    return Response.json(
      { ok: false, error: error?.message || 'pollBlitzortungLightning failed' },
      { status: 500 }
    );
  }
});