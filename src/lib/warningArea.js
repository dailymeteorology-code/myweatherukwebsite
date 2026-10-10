/* Geometry helpers for the warning before/after map.
 *
 * Kept apart from the component so the maths is plain, testable code rather
 * than something buried in a render.
 */

const KM_PER_DEG = 111.32;

/**
 * GeoJSON stores [lon, lat]; Leaflet wants [lat, lon].
 * Returns one entry per polygon, each a list of rings (outer first, holes after).
 */
export function toLatLngs(geometry) {
  if (!geometry?.coordinates) return [];
  const polys =
    geometry.type === 'Polygon' ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon' ? geometry.coordinates
        : [];
  return polys
    .map(rings =>
      rings
        .map(ring => ring.map(([lon, lat]) => [lat, lon]))
        .filter(ring => ring.length >= 3))
    .filter(rings => rings.length > 0);
}

/** Shoelace area of one ring, in square degrees, on an already-scaled x axis. */
function ringArea(ring, cosLat) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latA, lonA] = ring[j];
    const [latB, lonB] = ring[i];
    sum += (lonA * cosLat) * latB - (lonB * cosLat) * latA;
  }
  return Math.abs(sum / 2);
}

/**
 * Approximate area of a set of GeoJSON geometries, in km².
 *
 * Equirectangular projection about the shape's own mean latitude. Over a single
 * UK warning the distortion is well under the rounding already applied to the
 * stored outline, and the result is only ever shown as an approximate
 * percentage change — it is not a survey figure.
 */
export function areaKm2(geometries = []) {
  const polys = geometries.flatMap(toLatLngs);
  if (!polys.length) return 0;

  // Scale about the mid-latitude of the bounding box rather than the mean of
  // the vertices: vertex density varies wildly around a coastline, and averaging
  // them would drag the reference latitude towards whichever edge is drawn in
  // the most detail.
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const rings of polys) {
    for (const [lat] of rings[0]) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!Number.isFinite(minLat)) return 0;
  const cosLat = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);

  let total = 0;
  for (const rings of polys) {
    total += ringArea(rings[0], cosLat);
    // Rings after the first are holes and come off the total.
    for (let i = 1; i < rings.length; i += 1) total -= ringArea(rings[i], cosLat);
  }
  return Math.max(0, total) * KM_PER_DEG * KM_PER_DEG;
}
