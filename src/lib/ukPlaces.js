/* ════════════════════════════════════════════════════════════════════════════
   UK PLACE SUGGESTIONS
   ────────────────────────────────────────────────────────────────────────────
   Type-ahead for the location search, backed by Open-Meteo's geocoding API:
   free, keyless, CORS-open and built for search-as-you-type.

   WHY NOT NOMINATIM. The forecast function geocodes with OpenStreetMap's
   Nominatim, so matching it would seem natural — but the public Nominatim
   instance's usage policy forbids autocomplete and caps everyone at one request
   a second. Firing it on every keystroke would risk the whole app being blocked
   from the service the actual forecast lookup depends on.

   Because the two services can disagree about a name, picking a suggestion
   sends its COORDINATES to the forecast function rather than its text, so what
   you tapped is what you get. Typing a name and pressing enter still goes
   through the old text path.

   The four country codes are the same set the forecast function accepts, so a
   suggestion can never be offered that the forecast would then refuse — the
   Crown Dependencies (Isle of Man, Jersey, Guernsey) are Met Office territory
   and are deliberately included.
   ════════════════════════════════════════════════════════════════════════════ */

const ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';

export const UK_COUNTRY_CODES = new Set(['GB', 'IM', 'JE', 'GG']);

/** The bit under the name that tells two identically-named villages apart. */
export function regionOf(place) {
  if (!place) return '';
  if (place.country_code && place.country_code !== 'GB') return place.country || '';
  return place.admin2 || place.admin1 || place.admin3 || '';
}

/** Stable identity — Open-Meteo ids exist but coordinates survive a re-fetch. */
export function placeKey(place) {
  return `${place.name}|${regionOf(place)}|${Number(place.latitude).toFixed(3)},${Number(place.longitude).toFixed(3)}`;
}

export function toSuggestion(place) {
  return {
    key: placeKey(place),
    name: place.name,
    region: regionOf(place),
    country: place.country || '',
    countryCode: place.country_code || '',
    lat: place.latitude,
    lon: place.longitude,
    population: place.population ?? null,
  };
}

/**
 * UK place suggestions for a partial name, best match first.
 *
 * Returns [] for anything too short to be meaningful rather than sending a
 * request per character. Never throws: a failed lookup should quietly leave the
 * reader typing, not raise an error over a page that still works without it.
 */
export async function searchUkPlaces(query, { signal, limit = 7 } = {}) {
  const q = (query || '').trim();
  if (q.length < 2) return [];

  let results = [];
  try {
    const url = `${ENDPOINT}?name=${encodeURIComponent(q)}&count=25&language=en&format=json`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const json = await res.json();
    results = json?.results || [];
  } catch {
    return [];                      // includes AbortError on a newer keystroke
  }

  const lower = q.toLowerCase();
  const seen = new Set();
  return results
    .filter((r) => UK_COUNTRY_CODES.has(r.country_code))
    .map(toSuggestion)
    .filter((s) => {
      if (seen.has(s.key)) return false;
      seen.add(s.key);
      return true;
    })
    .sort((a, b) => {
      // Somebody typing "dunst" wants Dunstable before Chalton-under-Dunstable.
      const aStarts = a.name.toLowerCase().startsWith(lower);
      const bStarts = b.name.toLowerCase().startsWith(lower);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      const aExact = a.name.toLowerCase() === lower;
      const bExact = b.name.toLowerCase() === lower;
      if (aExact !== bExact) return aExact ? -1 : 1;
      return (b.population ?? 0) - (a.population ?? 0);
    })
    .slice(0, limit);
}
