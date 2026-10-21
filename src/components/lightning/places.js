/* Where a strike was, in words: the nearest town or city (UK & Ireland and Europe, from CITY_DB)
   with a direction, and around the British Isles the sea it is over. "100 km from Stornoway" for
   a strike west of the Uists said nothing useful; "over the Atlantic, 100 km south-west of
   Stornoway" does. The sea boxes are deliberately small and hold no land, so a name is only
   given where the strike is certainly offshore. */
import { CITY_DB } from '@/components/tcm/cityDB';

/* [name, [south, north, west, east]] */
const SEAS = [
  ['the Atlantic', [47.0, 56.3, -30, -10.6]],     // west of Ireland
  ['the Atlantic', [56.3, 61.0, -30, -7.9]],      // west of the Hebrides
  ['the North Sea', [53.6, 57.8, 0.6, 6.5]],
  ['the North Sea', [57.8, 59.3, -1.2, 4.5]],
  ['the English Channel', [49.75, 50.15, -4.8, -1.0]],
  ['the Irish Sea', [53.45, 54.0, -5.8, -3.3]],
  ['the Celtic Sea', [50.3, 51.3, -9.0, -6.0]],
  ['the Bay of Biscay', [44.0, 47.0, -9.0, -2.5]],
];
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

function nearest(lat, lon) {
  let best = null, bd = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (const c of CITY_DB) {
    const dy = c.lat - lat, dx = (c.lon - lon) * k;
    const d = dy * dy + dx * dx;
    if (d < bd) { bd = d; best = c; }
  }
  return best ? { city: best, km: Math.sqrt(bd) * 111 } : null;
}

/** "over Leeds", "near Leeds", "25 km south-west of Leeds", or "over the North Sea, 60 km east of
 *  Aberdeen". */
export function describePlace(lat, lon) {
  const n = nearest(lat, lon);
  if (!n) return 'Unknown location';
  const { city, km } = n;
  const sea = SEAS.find(([, [s, no, w, e]]) => lat >= s && lat <= no && lon >= w && lon <= e);
  if (!sea && km < 5) return `over ${city.name}`;
  if (!sea && km < 15) return `near ${city.name}`;
  const deg = (Math.atan2((lon - city.lon) * Math.cos((lat * Math.PI) / 180), lat - city.lat) * 180) / Math.PI;
  const rel = `${Math.round(km)} km ${DIRS[Math.round(((deg + 360) % 360) / 45) % 8]} of ${city.name}`;
  return sea ? `over ${sea[0]}, ${rel}` : rel;
}
