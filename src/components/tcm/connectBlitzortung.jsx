/* connectBlitzortung — the live strike feed.
 *
 * GOAL: miss nothing. Blitzortung is a push-only feed with no replay, so a
 * strike that arrives while we are between sockets is gone for good. Every
 * design choice below follows from that.
 *
 *  - SEVERAL SOCKETS, ALWAYS. We hold a pool of sockets open to DIFFERENT
 *    servers permanently and read strikes from all of them. The feed is
 *    mirrored, so this is pure redundancy: when one stalls, errors or is
 *    killed by a backgrounded tab, the others are already carrying the data
 *    and there is no gap at all. The old code opened a second socket only
 *    during a failover and then closed it again after six seconds, which left
 *    exactly one connection carrying everything the rest of the time.
 *
 *  - DUPLICATES ARE FREE. The React layer keys strikes by time-to-the-second
 *    and position-to-three-decimals, so the same strike arriving on three
 *    sockets collapses to one. Redundancy costs a little bandwidth and
 *    nothing else; a gap costs strikes.
 *
 *  - SILENCE IS FAILURE. Most real drops are not clean error or close events,
 *    they are sockets that quietly stop delivering. Any socket that has said
 *    nothing for SILENT_TIMEOUT_MS is replaced, and because its replacement
 *    opens alongside the pool rather than after it, the swap is seamless.
 *
 *  - A BACKGROUNDED TAB IS A SPECIAL CASE. Browsers throttle timers in hidden
 *    tabs to roughly one tick a minute, so the keepalive ping stops arriving
 *    on time and the server hangs up. Rather than wait for a watchdog that is
 *    itself throttled, we audit the whole pool the instant the tab is shown
 *    again, and rebuild whatever died while we were away.
 *
 *  - FALLBACK. After repeated failures against the public servers we fall
 *    back to our own Render worker, which proxies the same feed and gets
 *    through corporate and mobile firewalls that block ws*.blitzortung.org.
 */

const RENDER_WORKER_HOST = 'blitzortungworker-3.onrender.com';
const RENDER_WORKER_WS   = `wss://${RENDER_WORKER_HOST}`;
const BLITZORTUNG_DIRECT_SERVERS = [
  'wss://ws1.blitzortung.org',
  'wss://ws7.blitzortung.org',
  'wss://ws8.blitzortung.org',
];

/**
 * This used to drop every strike outside Europe before the caller ever saw it,
 * which made a worldwide view impossible however the map was configured. The
 * bound is now the caller's to choose: pass `bbox` to filter here (cheapest —
 * it runs before any allocation), or omit it to receive the whole planet.
 *
 * Filtering is policy, not transport, so the default is no filter.
 */
function inBox(lat, lon, b) {
  if (!b) return true;
  return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
}

// Max time (ms) a socket may go without ANY message before we consider it
// stalled and rotate. Blitzortung is busy enough across Europe that a healthy
// socket virtually always sends something within this window; if it doesn't,
// the connection is almost certainly wedged.
/* Dropped from 35 s now that the pool overlaps: rotating a suspect socket is
   free when two others are still delivering, so we can be impatient. */
const SILENT_TIMEOUT_MS = 20000;
const PING_MS           = 15000;
/* How many sockets to keep open at once. Two gives full redundancy against a
   single stall; three is belt and braces during a big outbreak when losing
   even a second of data is visible on the map. */
const TARGET_SOCKETS    = 3;
/* How often the pool is audited: topped up, and stalled members replaced. */
const AUDIT_MS          = 5000;

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
      if (h > code)                   a = d[i];
      else if (e[code] !== undefined) a = e[code];
      else                            a = f + c;
      g.push(a);
      c = a[0];
      e[o] = f + c;
      o++;
      f = a;
    }
    return JSON.parse(g.join(''));
  } catch (_) { return null; }
}

export function connectBlitzortung(onStrike, onStatusChange, options = {}) {
  // Omit `bbox` for worldwide coverage; pass one to filter at the socket.
  const bbox = options.bbox || null;
  const target = Math.max(1, options.sockets || TARGET_SOCKETS);
  let stopped = false;
  /* Every socket we hold open. Strikes are read from ALL of them; `primary`
     only decides which one the status line is reporting on. */
  const sockets = new Set();
  let primary = null;
  let serverIdx = 0;
  let consecutiveFailures = 0;
  let lastStrikeAt = 0;
  let audit = null;
  let status = null;

  /* Report a status change once, not on every audit tick. */
  function setStatus(next) {
    if (next === status) return;
    status = next;
    onStatusChange(next);
  }

  function liveSockets() {
    let n = 0;
    for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) n += 1;
    return n;
  }

  /* The next server to try. Spreading the pool across DIFFERENT hosts is the
     whole point — three sockets to one server share that server's fate, and a
     mirror going down would take all three with it. After repeated failures
     everywhere we fall back to our own Render worker. */
  function nextUrl() {
    if (consecutiveFailures >= 6) return RENDER_WORKER_WS;
    const inUse = new Set();
    for (const ws of sockets) if (ws._url) inUse.add(ws._url);
    for (let i = 0; i < BLITZORTUNG_DIRECT_SERVERS.length; i += 1) {
      const candidate = BLITZORTUNG_DIRECT_SERVERS[(serverIdx + i) % BLITZORTUNG_DIRECT_SERVERS.length];
      if (!inUse.has(candidate)) { serverIdx += i + 1; return candidate; }
    }
    // Pool is already wider than the server list — double up rather than stall.
    return BLITZORTUNG_DIRECT_SERVERS[serverIdx++ % BLITZORTUNG_DIRECT_SERVERS.length];
  }

  function teardownSocket(ws) {
    if (!ws) return;
    sockets.delete(ws);
    if (ws._ping) { clearInterval(ws._ping); ws._ping = null; }
    try { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; } catch (_) {}
    try { ws.close(); } catch (_) {}
    if (primary === ws) primary = null;
  }

  function handleMessage(ws, data) {
    ws._lastMsg = Date.now();
    // First socket to actually deliver data becomes primary for status.
    if (!primary || primary.readyState !== WebSocket.OPEN) {
      primary = ws;
      consecutiveFailures = 0;
    }
    setStatus('live');
    let parsed = null;
    try { parsed = JSON.parse(data); } catch (_) {}
    if (!parsed) parsed = blitzortungDecode(data);
    if (!parsed) return;
    const strikes = parsed.strikes || (parsed.lat !== undefined ? [parsed] : null);
    if (!strikes) return;
    const nowMs = Date.now();
    for (const s of strikes) {
      // Blitzortung sends nanoseconds (~1.7e18). Use precise unit thresholds so
      // an already-millisecond value (~1.7e12) is never mis-divided: ns are
      // > 1e15, ms are > 1e12, seconds are > 1e9. Anything below is treated as
      // already-ms / now.
      let timeMs;
      if (!s.time)            timeMs = nowMs;
      else if (s.time > 1e15) timeMs = Math.floor(s.time / 1e6); // ns  -> ms
      else if (s.time > 1e12) timeMs = s.time;                    // ms  (already)
      else if (s.time > 1e9)  timeMs = s.time * 1000;             // s   -> ms
      else                    timeMs = nowMs;
      let lat = s.lat, lon = s.lon;
      if (Math.abs(lat) > 90)  lat = lat / 1e7;
      if (Math.abs(lon) > 180) lon = lon / 1e7;
      if (isNaN(lat) || isNaN(lon)) continue;
      if (!inBox(lat, lon, bbox)) continue;
      lastStrikeAt = nowMs;
      onStrike({ lat, lon, time: timeMs, amp: s.mamp || 0 });
    }
  }

  function connect() {
    if (stopped || sockets.size >= target + 1) return;
    const url = nextUrl();
    let ws;
    try { ws = new WebSocket(url); } catch (_) { return; }
    ws._url = url;
    ws._lastMsg = Date.now();
    ws._openedAt = Date.now();
    sockets.add(ws);
    if (!primary) setStatus(status === 'live' ? 'reconnecting' : 'connecting');

    ws.onopen = () => {
      if (stopped) { teardownSocket(ws); return; }
      ws._lastMsg = Date.now();
      try { ws.send(JSON.stringify({ a: 111 })); } catch (_) {}
      ws._ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ a: 111 })); } catch (_) {} }
        else { clearInterval(ws._ping); ws._ping = null; }
      }, PING_MS);
    };

    ws.onmessage = (evt) => {
      if (stopped) return;
      try { handleMessage(ws, evt.data); } catch (_) {}
    };

    const gone = () => {
      if (ws._ping) { clearInterval(ws._ping); ws._ping = null; }
      teardownSocket(ws);
      if (stopped) return;
      consecutiveFailures += 1;
      /* No scheduled reconnect dance: the audit tick below tops the pool back
         up within AUDIT_MS, and the other sockets are still delivering in the
         meantime. The old code's 2–4 s reconnect timers existed only because
         there was nothing else carrying the feed. */
      if (liveSockets() === 0) setStatus('reconnecting');
      topUp();
    };
    ws.onerror = gone;
    ws.onclose  = gone;
  }

  /* Bring the pool back up to strength. Opening several at once is fine —
     they are cheap, and a storm is exactly when we least want to trickle. */
  function topUp() {
    if (stopped) return;
    let healthy = 0;
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) healthy += 1;
    }
    for (let i = healthy; i < target; i += 1) connect();
  }

  /* Replace anything that has gone quiet, then top the pool up. Run on a timer
     and again the moment the tab comes back to the foreground. */
  function auditPool() {
    if (stopped) return;
    const now = Date.now();
    for (const ws of Array.from(sockets)) {
      const silent = now - (ws._lastMsg || 0);
      const connecting = ws.readyState === WebSocket.CONNECTING;
      // A socket that never finished connecting is as dead as a silent one.
      if ((connecting && now - ws._openedAt > SILENT_TIMEOUT_MS) ||
          (ws.readyState === WebSocket.OPEN && silent > SILENT_TIMEOUT_MS)) {
        consecutiveFailures += 1;
        if (ws._ping) { clearInterval(ws._ping); ws._ping = null; }
        teardownSocket(ws);
      } else if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        teardownSocket(ws);
      }
    }
    topUp();
    options.onPool?.(liveSockets(), target);
    if (liveSockets() === 0) setStatus(status === 'live' ? 'reconnecting' : 'connecting');
    else if (Date.now() - lastStrikeAt < 5 * 60 * 1000 || status === 'live') setStatus('live');
  }

  audit = setInterval(auditPool, AUDIT_MS);

  /* A hidden tab's timers are throttled to about one tick a minute, which is
     slower than the server's own keepalive window — so sockets routinely die
     while the tab is in the background and the audit above cannot notice in
     time. Check the moment we are visible again. */
  function onVisibility() {
    if (document.visibilityState === 'visible') auditPool();
  }
  /* The same applies to a laptop waking from sleep or a phone regaining
     signal: both fire 'online' without any visibility change. */
  function onOnline() { consecutiveFailures = 0; auditPool(); }

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

  topUp();

  return () => {
    stopped = true;
    clearInterval(audit);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    for (const ws of Array.from(sockets)) teardownSocket(ws);
  };
}
