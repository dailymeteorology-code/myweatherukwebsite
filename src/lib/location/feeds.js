/* Outside feeds the Location page reads straight from the browser (both send CORS headers, so no
   server route is needed), kept in localStorage so a visitor fetches each rarely:
     • NOAA SWPC's planetary Kp index, observed and forecast three-hourly (the aurora), 30 minutes
     • gov.uk's bank holidays for England and Wales, Scotland and Northern Ireland, a day
   A feed that cannot be reached gives null, and the card that uses it simply leaves that part out. */
const STORE = 'lw-feeds-v1';
const read = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } };
function write(key, body) {
  try { const all = read(); all[key] = { at: Date.now(), body }; localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* storage full or blocked */ }
}
const inflight = new Map();
async function cached(key, url, maxAgeMs, trim = (x) => x) {
  const hit = read()[key];
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.body;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = trim(await res.json());
      write(key, body);
      return body;
    } catch {
      return hit?.body ?? null;   // an older copy beats nothing
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

/** [{t (ms, the start of the 3 h period), kp, observed}] for the last few days and the next three. */
export const fetchKp = () => cached('kp', 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json', 30 * 60e3,
  (rows) => (Array.isArray(rows) ? rows : []).map((r) => ({ t: Date.parse(`${r.time_tag}Z`), kp: Number(r.kp), observed: r.observed === 'observed' }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.kp)));

/** {'england-and-wales': {events: [{title, date}]}, scotland, 'northern-ireland'}, from today on. */
export const fetchBankHolidays = () => cached('bank', 'https://www.gov.uk/bank-holidays.json', 24 * 36e5, (body) => {
  const today = new Date().toISOString().slice(0, 10);
  const out = {};
  for (const [k, v] of Object.entries(body || {})) out[k] = { events: (v.events || []).filter((e) => e.date >= today).map((e) => ({ title: e.title, date: e.date })) };
  return out;
});
