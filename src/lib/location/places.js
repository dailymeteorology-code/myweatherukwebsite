/* Your places (Location Weather, 15 Nov 2026, Phase D): the places a reader keeps, which is Home and
   which is Work, and their commute (out and back times, which days). Kept in this browser, and for a
   signed-in reader also on their account, in the same LocationSearchHistory record as their recent
   searches (src/lib/locationHistory.js), so they follow them to other devices; the account's copy wins
   when the page loads. */
import { base44 } from '@/api/base44Client';

const KEY = 'lw-places-v1';
export const MAX_PLACES = 12;
export const DEFAULT_COMMUTE = { out: '08:00', back: '17:30', days: [1, 2, 3, 4, 5] };   // Monday .. Friday
const EMPTY = { places: [], commute: DEFAULT_COMMUTE };

export const samePlace = (a, b) => !!a && !!b && Math.abs((a.lat ?? 0) - (b.lat ?? 0)) < 0.01 && Math.abs((a.lon ?? 0) - (b.lon ?? 0)) < 0.01;
const clean = (d) => ({
  places: (Array.isArray(d?.places) ? d.places : [])
    .filter((p) => p && p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p) => ({ name: String(p.name).slice(0, 80), region: p.region || '', lat: Math.round(p.lat * 1e4) / 1e4, lon: Math.round(p.lon * 1e4) / 1e4, label: p.label === 'home' || p.label === 'work' ? p.label : null }))
    .slice(0, MAX_PLACES),
  commute: {
    out: /^\d{2}:\d{2}$/.test(d?.commute?.out || '') ? d.commute.out : DEFAULT_COMMUTE.out,
    back: /^\d{2}:\d{2}$/.test(d?.commute?.back || '') ? d.commute.back : DEFAULT_COMMUTE.back,
    days: Array.isArray(d?.commute?.days) ? d.commute.days.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6) : DEFAULT_COMMUTE.days,
  },
});
const readLocal = () => { try { return clean(JSON.parse(localStorage.getItem(KEY) || 'null') || EMPTY); } catch { return clean(EMPTY); } };
const writeLocal = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage blocked */ } };

const entity = () => base44.entities.LocationSearchHistory;
async function rowFor(email) {
  try { return (await entity().filter({ user_email: email }))?.[0] || null; } catch { return null; }
}

/** {places, commute}: the account's when it has any, else this browser's. Never throws. */
export async function loadPlaces(user) {
  const local = readLocal();
  if (!user?.email) return local;
  const row = await rowFor(user.email);
  if (row && (Array.isArray(row.places) || row.commute)) {
    const acc = clean({ places: row.places || [], commute: row.commute || local.commute });
    writeLocal(acc);
    return acc;
  }
  /* places kept in this browser before signing in go up to the account */
  if (local.places.length) savePlaces(user, local);
  return local;
}

/** Keep {places, commute}; returns what was kept (cleaned). */
export async function savePlaces(user, data) {
  const d = clean(data);
  writeLocal(d);
  if (user?.email) {
    try {
      const row = await rowFor(user.email);
      if (row) await entity().update(row.id, { places: d.places, commute: d.commute });
      else await entity().create({ user_email: user.email, recent: [], places: d.places, commute: d.commute, updated_at: new Date().toISOString() });
    } catch { /* kept in this browser at least */ }
  }
  return d;
}

/* edits */
export const isSaved = (d, p) => d.places.some((x) => samePlace(x, p));
export const toggleSaved = (d, p) => (isSaved(d, p)
  ? { ...d, places: d.places.filter((x) => !samePlace(x, p)) }
  : { ...d, places: [...d.places, { name: p.name, region: p.region || '', lat: p.lat, lon: p.lon, label: null }].slice(-MAX_PLACES) });
/* one Home and one Work: giving a place a label takes it off any other */
export const setLabel = (d, p, label) => ({
  ...d,
  places: d.places.map((x) => (samePlace(x, p) ? { ...x, label: x.label === label ? null : label } : x.label === label ? { ...x, label: null } : x)),
});
export const placeWith = (d, label) => d.places.find((x) => x.label === label) || null;
