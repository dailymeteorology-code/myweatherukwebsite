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

// The four standard synoptic model-run hours (UTC).
export const RUN_HOURS_UTC = [0, 6, 12, 18];

// A run stays valid for its full 6-hour cycle (00–06Z, 06–12Z, 12–18Z, 18–00Z).
const WINDOW_MS = 6 * 60 * 60 * 1000;

// Per-region localStorage key for the last-fetch timestamp. Bumped to v5 for the
// UTC-based policy so stale v4 entries (BST-shifted timestamps) can't poison a
// cold-start lookup.
export const policyKey = (region) => `tcm_policy_v5_${region}`;

// UTC ms of the most recent run hour that has passed (falls back to yesterday's
// 18Z before today's 00Z window opens).
export function lastRunStartMs(now = Date.now()) {
  const d = new Date(now);
  const h = d.getUTCHours();
  let runHour = -1;
  for (const hr of RUN_HOURS_UTC) if (hr <= h) runHour = hr;
  if (runHour < 0) {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1, 18);
  }
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), runHour);
}

// True if `now` sits inside the current run's 6-hour validity window.
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

// Time remaining (ms) until the NEXT scheduled UTC run window opens.
export function msUntilNextFetch(region) { // eslint-disable-line no-unused-vars
  const now = Date.now();
  const d = new Date(now);
  const h = d.getUTCHours();
  let nextHour = -1;
  for (const hr of RUN_HOURS_UTC) { if (hr > h) { nextHour = hr; break; } }
  const next = nextHour < 0
    ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, RUN_HOURS_UTC[0])
    : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), nextHour);
  return Math.max(0, next - now);
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