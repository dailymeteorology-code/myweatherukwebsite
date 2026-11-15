/* More places on Model Data's map as you zoom in (15 Nov 2026): the towns, villages and suburbs of
   Great Britain and Ireland (GeoNames, CC BY 4.0: public/data/places-gbie.json, from the motion
   graphics' gazetteer), ranked by how many people live there so that each step of zoom lets in the
   next tier (modelViewer drawCities). The grid's own cities.json keeps ranks 1-3 (the hand-picked
   cities, abroad too); these take 3 (big cities the list lacks) to 9 (hamlets), suburbs a tier lower
   than their size alone would give, as they sit inside the towns. */
import { projection } from '@/lib/modelGrids';

let placesP = null;
const load = () => (placesP ||= fetch('/data/places-gbie.json').then((r) => r.json()).then((d) => d.places || []).catch(() => { placesP = null; return []; }));

const rankOf = (pop, kind) => Math.min(9, (pop >= 250000 ? 3 : pop >= 100000 ? 4 : pop >= 40000 ? 5 : pop >= 15000 ? 6 : pop >= 5000 ? 7 : pop >= 1000 ? 8 : 9)
  + (kind === 's' ? 1 : 0));

/** The grid's cities with the gazetteer's places added, on the grid's cells ({ name, x, y, rank, pop }).
    A place the list already has (the same name within a few cells) is not added twice. */
export async function withMorePlaces(cities, grid) {
  const list = await load();
  if (!list.length || !cities) return cities;
  const P = projection(grid);
  const have = new Map(cities.map((c) => [c.name.toLowerCase(), c]));
  const out = [...cities];
  for (const [name, lat, lon, pop, kind] of list) {
    const [x, y] = P.toGrid(lon, lat);
    const same = have.get(name.toLowerCase());
    if (same && Math.hypot(same.x - x, same.y - y) < 6) continue;
    out.push({ name, x, y, rank: rankOf(pop, kind), pop });
  }
  return out;
}
