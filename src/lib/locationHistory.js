/* Recent Location Weather searches for a signed-in reader.
 *
 * One LocationSearchHistory record per user holding a capped list, rather than
 * a row per search: the page reads it on every load and only ever shows a
 * handful, so a growing table of rows would cost more and buy nothing.
 *
 * Coordinates are stored alongside the name. Re-running a recent search then
 * goes straight back to the same point instead of being geocoded again, which
 * matters for the many UK place names that are not unique.
 *
 * Signed-out readers get nothing persisted — that is deliberate, not an
 * oversight. Every function here is a no-op without a user.
 */
import { base44 } from '@/api/base44Client';

export const MAX_RECENT = 8;

const entity = () => base44.entities.LocationSearchHistory;

/** Same place? Compare position, not spelling — two gazetteers may differ. */
const samePlace = (a, b) =>
  Math.abs((a.lat ?? 0) - (b.lat ?? 0)) < 0.01 &&
  Math.abs((a.lon ?? 0) - (b.lon ?? 0)) < 0.01;

/** The signed-in user, or null. Never throws. */
export async function currentUser() {
  try {
    return await base44.auth.me();
  } catch {
    return null;
  }
}

/** Existing record for this user, or null. */
async function rowFor(email) {
  try {
    const rows = await entity().filter({ user_email: email });
    return rows?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * Recent searches, newest first. Empty for signed-out readers, and empty
 * rather than throwing if the lookup fails — a history panel is a convenience
 * and must never take the forecast page down with it.
 */
export async function loadRecent(user) {
  if (!user?.email) return [];
  const row = await rowFor(user.email);
  const recent = Array.isArray(row?.recent) ? row.recent : [];
  return recent.filter((r) => r && r.name).slice(0, MAX_RECENT);
}

/**
 * Record a search, moving a repeat back to the top rather than duplicating it.
 * Returns the new list so the caller can render it without re-reading.
 */
export async function rememberSearch(user, place) {
  if (!user?.email || !place?.name) return null;
  const entry = {
    name: place.name,
    region: place.region || '',
    lat: place.lat ?? null,
    lon: place.lon ?? null,
    at: new Date().toISOString(),
  };

  const row = await rowFor(user.email);
  const previous = Array.isArray(row?.recent) ? row.recent : [];
  const next = [entry, ...previous.filter((r) => !samePlace(r, entry))].slice(0, MAX_RECENT);

  try {
    if (row) await entity().update(row.id, { recent: next, updated_at: entry.at });
    else await entity().create({ user_email: user.email, recent: next, updated_at: entry.at });
  } catch {
    return next;    // the list is still correct on screen even if the save failed
  }
  return next;
}

/** Drop one entry. Returns the new list, or null if nothing could be done. */
export async function forgetSearch(user, place) {
  if (!user?.email) return null;
  const row = await rowFor(user.email);
  if (!row) return null;
  const next = (Array.isArray(row.recent) ? row.recent : []).filter((r) => !samePlace(r, place));
  try {
    await entity().update(row.id, { recent: next, updated_at: new Date().toISOString() });
  } catch {
    return null;
  }
  return next;
}

/** Clear the lot. */
export async function clearRecent(user) {
  if (!user?.email) return null;
  const row = await rowFor(user.email);
  if (!row) return [];
  try {
    await entity().update(row.id, { recent: [], updated_at: new Date().toISOString() });
  } catch {
    return null;
  }
  return [];
}
