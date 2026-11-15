/* Model Data favourites (15 Nov 2026, at the user's request: "my places, my layers, my comparisons"),
   kept in this browser: layers starred in the picker, places saved from a pin, and two-window
   comparisons saved from Compare. */
const KEY = 'md-favs-v1';
const EMPTY = { places: [], layers: [], compares: [] };

export function readFavs() {
  try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...EMPTY }; }
}
export function writeFavs(f) {
  try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* a private window: nothing kept */ }
}
/** star or unstar a layer */
export const toggleLayer = (f, key) => ({ ...f, layers: f.layers.includes(key) ? f.layers.filter((k) => k !== key) : [...f.layers, key] });
/** a place ({ name, lon, lat }), newest first, no two in the same spot */
export const addPlace = (f, p) => ({ ...f, places: [p, ...f.places.filter((x) => Math.hypot(x.lon - p.lon, x.lat - p.lat) > 0.01)].slice(0, 30) });
export const removePlace = (f, i) => ({ ...f, places: f.places.filter((_, k) => k !== i) });
/** a comparison ({ name, modelId, varKey, cmp }), newest first */
export const addCompare = (f, c) => ({ ...f, compares: [c, ...f.compares.filter((x) => x.name !== c.name)].slice(0, 20) });
export const removeCompare = (f, i) => ({ ...f, compares: f.compares.filter((_, k) => k !== i) });
