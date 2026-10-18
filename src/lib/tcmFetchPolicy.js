// ─────────────────────────────────────────────────────────────────────────────
// TCM FETCH POLICY — the ONE run-window and admin gate for the outlook engine.
//
// HARD RULE: outlook data is only refreshed at the four standard model run times
// — 00, 06, 12 and 18 UTC. These are universal across meteorological centres
// (UKMO, ECMWF and NOAA all publish at the same Z hours), and model runs are
// UTC — BST is purely a display concept and never shifts when a fetch happens.
// Loading the page outside a run's validity window MUST NOT trigger a network
// fetch; cached data is served instead. Admins may still force-refresh via the
// explicit "Run Model" button (which passes force:true and bypasses this gate).
//
// This file previously had a near-identical twin, lib/tcmDataFetch.js, which was
// imported by nothing and carried a WEAKER admin check (it recognised only the
// exact string role 'admin', missing 'ADMIN', the isAdmin boolean and the roles
// array shapes Base44 can return). That twin is now redundant and should be
// deleted — this module is the single source of the policy, with the robust
// admin detection folded in.
//
// Semantics (unchanged): a run is "valid" for the whole 6-hour window that starts
// at its UTC run hour; within that window a fetch is DUE once, until it has been
// recorded via setLastFetch. The four run-hour helpers are exported so the data
// pipeline (lib/openMeteoTCM.js) can share this exact definition instead of
// keeping its own copy.
// ─────────────────────────────────────────────────────────────────────────────

import { base44 } from '@/api/base44Client';

// TCM V3 runs twice a day, at 03:00 and 15:00 UK time (Europe/London, so it follows
// BST/GMT). The runs are made on GitHub from AWS data (.github/workflows/tcm-v3.yml).
export const RUN_HOURS_LOCAL = [3, 15];
export const RUN_HOURS_UTC = RUN_HOURS_LOCAL;   // legacy export name; values are UK local hours now

// A run stays current until the next one (12 hours).
const WINDOW_MS = 12 * 60 * 60 * 1000;

// Per-region localStorage key for the last-fetch timestamp. v6: UK-local 03/15 schedule.
export const policyKey = (region) => `tcm_policy_v6_${region}`;

function londonOffsetMs(t) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
  const g = (k) => Number(f.find((x) => x.type === k).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - Math.floor(t / 60000) * 60000;
}
// UTC instant of HH:00 UK time on the UK calendar day containing `dayRef` (+ dayShift days).
function londonHourMs(dayRef, hour, dayShift = 0) {
  const local = new Date(dayRef + londonOffsetMs(dayRef));
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayShift, hour);
  return guess - londonOffsetMs(guess);
}

// UTC ms of the most recent 03:00/15:00 UK run that has passed.
export function lastRunStartMs(now = Date.now()) {
  const cands = [];
  for (const shift of [-1, 0]) for (const h of RUN_HOURS_LOCAL) cands.push(londonHourMs(now, h, shift));
  return Math.max(...cands.filter((t) => t <= now));
}

// True if `now` sits inside the current run's validity window.
export function isInRunWindow(now = Date.now()) {
  const elapsed = now - lastRunStartMs(now);
  return elapsed >= 0 && elapsed <= WINDOW_MS;
}

// ── Per-region last-fetch bookkeeping ────────────────────────────────────────
export function getLastFetch(region) {
  try {
    const n = Number(localStorage.getItem(policyKey(region)));
    return Number.isFinite(n) ? n : 0;
  } catch { return 0; }
}

export function setLastFetch(region, ts = Date.now()) {
  try { localStorage.setItem(policyKey(region), String(ts)); } catch {}
}

// True when we are inside the current run window AND have not yet fetched for it.
export function isFetchDue(region) {
  const now = Date.now();
  if (!isInRunWindow(now)) return false;
  return getLastFetch(region) < lastRunStartMs(now);
}

// Time remaining (ms) until the next 03:00 / 15:00 UK run.
export function msUntilNextFetch(region) { // eslint-disable-line no-unused-vars
  const now = Date.now();
  const cands = [];
  for (const shift of [0, 1]) for (const h of RUN_HOURS_LOCAL) cands.push(londonHourMs(now, h, shift));
  return Math.max(0, Math.min(...cands.filter((t) => t > now)) - now);
}

// Format ms remaining as "Xh Ym" (or "now").
export function formatRemaining(ms) {
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

// ── Admin detection ──────────────────────────────────────────────────────────
// Base44 can return the admin flag in several shapes depending on how the app is
// configured — a role string ('admin' or 'ADMIN'), a boolean isAdmin flag, or a
// roles array. Recognise all of them. (Server-side RLS still enforces admin on
// every write, so this client check only governs which controls are shown.)
function detectAdmin(user) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'ADMIN') return true;
  if (user.isAdmin === true) return true;
  if (Array.isArray(user.roles) && user.roles.some(r => r === 'admin' || r === 'ADMIN')) return true;
  return false;
}

// Result is cached briefly and concurrent calls are de-duplicated, so the many
// components that gate on admin status don't each fire their own auth.me().
const ADMIN_TTL_MS = 20_000;
let _adminCache = null;      // { value, at }
let _adminInFlight = null;

export async function isCurrentUserAdmin() {
  const now = Date.now();
  if (_adminCache && (now - _adminCache.at) < ADMIN_TTL_MS) return _adminCache.value;
  if (_adminInFlight) return _adminInFlight;

  _adminInFlight = (async () => {
    let result = false;
    try {
      const user = await base44.auth.me();
      if (import.meta.env?.MODE !== 'production') {
        console.log('[TCM] auth.me() result:', JSON.stringify(user));
      }
      result = detectAdmin(user);
    } catch { result = false; }
    _adminCache = { value: result, at: Date.now() };
    _adminInFlight = null;
    return result;
  })();
  return _adminInFlight;
}

// Bust the admin cache after an explicit sign-in / sign-out so the next check
// re-reads auth immediately instead of waiting out the TTL.
export function clearAdminCache() {
  _adminCache = null;
  _adminInFlight = null;
}