/* The land of the UK & Ireland (and the coasts around them) for drawing on a canvas in Web
   Mercator: the day thumbnails on TCM Verification, and the outline a graphic is lined up against
   on Forecast Verification. Read from the counties file the Graphic Studio's maps are drawn from
   (public/geo/uk-ie-counties.json: [lon, lat, lon, lat, …] rings). */

let loading = null;
/** { counties: rings, context: rings }, each ring a flat [lon, lat, …] array. */
export function loadLand() {
  if (!loading) {
    loading = fetch('/geo/uk-ie-counties.json')
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((raw) => ({
        counties: raw.areas.flatMap((a) => a.polys.flat()),
        context: (raw.context || []).flatMap((c) => c.polys.flat()),
      }))
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}

const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
/** Web Mercator from a box ({ west, east, north, south }) to a w x h picture. */
export function mercator(box, w, h) {
  const top = merc(box.north), span = top - merc(box.south);
  return (lon, lat) => [((lon - box.west) / (box.east - box.west)) * w, ((top - merc(lat)) / span) * h];
}

/** Trace rings as one path, leaving out points closer than `gap` pixels to the last one kept. */
export function traceRings(ctx, rings, project, gap = 0.7) {
  ctx.beginPath();
  for (const ring of rings) {
    let lx = null, ly = null, n = 0;
    for (let k = 0; k < ring.length; k += 2) {
      const [x, y] = project(ring[k], ring[k + 1]);
      if (lx !== null && Math.abs(x - lx) < gap && Math.abs(y - ly) < gap && k < ring.length - 2) continue;
      if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      lx = x; ly = y; n += 1;
    }
    if (n) ctx.closePath();
  }
}
