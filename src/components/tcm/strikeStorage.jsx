/* Strike storage helpers extracted from pages/TCM */

export const STORE_KEY       = 'tcm_today_strikes';
export const DATE_KEY        = 'tcm_today_date';
export const ARCHIVE_KEY     = 'tcm_lightning_archive';
export const STORM_STORE_KEY = 'tcm_storm_warnings';
export const SNAPSHOT_KEY    = 'tcm_forced_snapshots';
// Shared key read by the TCMOutlooksV3 LightningOverlay
const WP_CACHE_KEY           = 'tcm_lightning_strikes_today';

export function todayDateStr() { return new Date().toISOString().slice(0, 10); }
export function localDateKey(ts) { return new Date(ts || Date.now()).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

export function loadStoredWarnings() {
  try {
    const arr = JSON.parse(localStorage.getItem(STORM_STORE_KEY) || '[]');
    return arr.filter(w => w.expiresAt && w.expiresAt > Date.now());
  } catch (_) { return []; }
}
export function saveWarnings(polys) {
  try {
    const live = (polys || []).filter(w => w.expiresAt && w.expiresAt > Date.now());
    localStorage.setItem(STORM_STORE_KEY, JSON.stringify(live));
  } catch (_) {}
}
export function broadcastWarnings(polys) {
  try {
    const live = (polys || []).filter(w => w.expiresAt && w.expiresAt > Date.now());
    localStorage.setItem(STORM_STORE_KEY, JSON.stringify(live));
    window.dispatchEvent(new StorageEvent('storage', { key: STORM_STORE_KEY, newValue: JSON.stringify(live), storageArea: localStorage }));
  } catch (_) {}
}
export function loadSnapshots() { try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '[]'); } catch (_) { return []; } }
export function saveSnapshot(snap) {
  try {
    const all = loadSnapshots(); all.push(snap);
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const trimmed = all.filter(s => s.capturedAt && s.capturedAt > cutoff);
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(trimmed));
  } catch (_) {}
}

/* UTC midnight — consistent with historicalLightning which uses UTC day boundaries.
   Using local midnight caused strikes to be pruned/missed around the midnight hour. */
export function startOfTodayMs() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

export function loadTodayStrikes() {
  try {
    const cutoff = startOfTodayMs();
    // Try plain array first
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      if (Array.isArray(stored)) {
        const fresh = stored.filter(s => s && s.time && s.time >= cutoff);
        if (fresh.length) return fresh;
      }
    }
    // Fall back to compressed format
    if (localStorage.getItem(STORE_KEY + '_isC') === 'true') {
      const compressed = JSON.parse(localStorage.getItem(STORE_KEY + '_c') || '[]');
      const restored = compressed
        .map(c => Array.isArray(c) ? { lat: c[0], lon: c[1], time: c[2], amp: 0 } : c)
        .filter(s => s && s.time && s.time >= cutoff);
      // Restore to plain format for future reads
      localStorage.removeItem(STORE_KEY + '_isC');
      localStorage.removeItem(STORE_KEY + '_c');
      saveTodayStrikes(restored);
      return restored;
    }
    return [];
  } catch (_) { return []; }
}

export function saveTodayStrikes(strikes) {
  try {
    const cutoff = startOfTodayMs();
    const filtered = strikes.filter(s => s && s.time && s.time >= cutoff);
    filtered.sort((a, b) => a.time - b.time);
    localStorage.setItem(DATE_KEY, todayDateStr());

    // ── Primary save: plain JSON array ──────────────────────────────────────
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(filtered));
      // Clear any leftover compressed keys so loadTodayStrikes reads the plain format
      localStorage.removeItem(STORE_KEY + '_isC');
      localStorage.removeItem(STORE_KEY + '_c');
      localStorage.setItem('tcm_strike_meta', JSON.stringify({
        count: filtered.length, savedAt: Date.now(),
        newestTs: filtered.length ? filtered[filtered.length - 1].time : 0,
        oldestTs: filtered.length ? filtered[0].time : 0,
      }));
    } catch (quotaErr) {
      // Quota exceeded — save compressed
      const compressed = filtered.map(s => [
        Math.round(s.lat * 10000) / 10000,
        Math.round(s.lon * 10000) / 10000,
        s.time,
      ]);
      try {
        localStorage.setItem(STORE_KEY + '_c', JSON.stringify(compressed));
        localStorage.setItem(STORE_KEY + '_isC', 'true');
        localStorage.removeItem(STORE_KEY);
      } catch (_) {
        // Last resort: save as many of the most recent as fit. Raised from 30k
        // because 100k+ strike days are now possible (the backend no longer caps
        // at 40k); keep the freshest 80k so a reload retains far more of the day.
        try { localStorage.setItem(STORE_KEY, JSON.stringify(filtered.slice(-80000))); } catch (_2) {}
      }
    }

    // ── Keep TCMOutlooksV3 LightningOverlay in sync ────────────────────────
    // WP reads { date, strikes } from this key. Write it every time so both
    // pages always see the same complete set without needing TCM to run first.
    try {
      localStorage.setItem(WP_CACHE_KEY, JSON.stringify({
        date: todayDateStr(),
        strikes: filtered,
      }));
    } catch (_) {
      try {
        localStorage.setItem(WP_CACHE_KEY, JSON.stringify({
          date: todayDateStr(),
          strikes: filtered.slice(-80000),
        }));
      } catch (_2) {}
    }

    // Dispatch a storage event so same-tab listeners (LightningOverlay) also update
    try {
      window.dispatchEvent(new StorageEvent('storage', {
        key: STORE_KEY,
        newValue: localStorage.getItem(STORE_KEY),
        storageArea: localStorage,
      }));
    } catch (_) {}
  } catch (e) {}
}

export function loadNewStrikesSince(sinceTs) {
  try {
    const cutoff = startOfTodayMs();
    const stored = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return stored.filter(s => s && s.time && s.time >= cutoff && s.time > sinceTs);
  } catch (_) { return []; }
}
export function loadArchive()  { try { return JSON.parse(localStorage.getItem(ARCHIVE_KEY)  || '[]'); } catch (_) { return []; } }
export function saveArchive(a) { try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(a)); } catch (_) {} }