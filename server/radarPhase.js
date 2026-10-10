/**
 * PRECIPITATION PHASE FIELD FOR THE RADAR
 *
 * Radar tells you where precipitation is and how heavy it is. It does not tell
 * you what form it takes — reflectivity cannot separate rain from sleet from
 * freezing rain, and the public composites do not publish the dual-polarisation
 * products that would help. Every consumer radar that shows snow in blue and
 * ice in purple is doing what this file does: taking the phase from a model's
 * thermal profile and painting the observed echo with it.
 *
 * RainViewer's tiles already carry a rain/snow split of their own, which the
 * client decodes straight from the pixel. This field refines that binary into
 * four — rain, sleet, snow, freezing rain — using surface wet-bulb temperature
 * and the freezing level.
 *
 * WET-BULB, NOT AIR TEMPERATURE. Falling snow evaporates into unsaturated air
 * and cools it, so snow routinely reaches the ground with the thermometer
 * reading 3-4 °C. Wet-bulb is what actually decides the outcome; using dry-bulb
 * would draw rain over half the snow events of a normal winter.
 *
 * FREEZING LEVEL SEPARATES SLEET FROM FREEZING RAIN. A sub-zero surface under a
 * freezing level that sits well above the ground means there is a warm layer
 * aloft: snow melts on the way down and refreezes on contact. That is freezing
 * rain, and it is the one of the four worth being warned about.
 *
 * The grid is coarse — roughly 50 km — because thermal fields are smooth and
 * the client interpolates. It will not resolve a snow line pinned to a hillside;
 * nothing at this resolution can, and the legend says "estimated" for that
 * reason.
 */

/* Matches RADAR_BBOX in the radar component. */
const LON_MIN = -11;
const LON_STEP = 0.75;
const COLS = 19;                       // −11.00 … 2.50
const LAT_MIN = 49.5;
const LAT_STEP = 0.5;
const ROWS = 24;                       // 49.5 … 61.0

const CHUNK = 120;                     // Open-Meteo takes ~150 points per call
const TTL_MS = 10 * 60 * 1000;         // the thermal field does not race
const STALE_MS = 3 * 60 * 60 * 1000;   // serve an old field rather than none

let cache = null;                      // { at, payload }
let inFlight = null;

/**
 * Wet-bulb temperature from dry-bulb and relative humidity (Stull 2011).
 * Accurate to a few tenths of a degree over the range that matters here.
 */
export function wetBulb(t, rh) {
  const r = Math.min(99, Math.max(5, rh));
  return (
    t * Math.atan(0.151977 * Math.sqrt(r + 8.313659)) +
    Math.atan(t + r) -
    Math.atan(r - 1.676331) +
    0.00391838 * Math.pow(r, 1.5) * Math.atan(0.023101 * r) -
    4.686035
  );
}

function gridPoints() {
  const pts = [];
  for (let j = 0; j < ROWS; j += 1) {
    for (let i = 0; i < COLS; i += 1) {
      pts.push([LAT_MIN + j * LAT_STEP, LON_MIN + i * LON_STEP]);
    }
  }
  return pts;
}

async function fetchChunk(points, model) {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${points.map((p) => p[0].toFixed(3)).join(',')}` +
    `&longitude=${points.map((p) => p[1].toFixed(3)).join(',')}` +
    '&current=temperature_2m,relative_humidity_2m,freezing_level_height' +
    (model ? `&models=${model}` : '') +
    '&timezone=GMT';

  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const body = await res.json();
  const rows = Array.isArray(body) ? body : [body];
  if (rows.length !== points.length) throw new Error('point count mismatch');
  return rows;
}

async function build() {
  const points = gridPoints();
  const tw = new Array(points.length).fill(null);
  const fzl = new Array(points.length).fill(null);

  for (let o = 0; o < points.length; o += CHUNK) {
    const slice = points.slice(o, o + CHUNK);
    let rows;
    try {
      rows = await fetchChunk(slice, 'ukmo_seamless');
    } catch {
      // The UK model is the right one over this domain, but a blend is far
      // better than a hole in the field.
      rows = await fetchChunk(slice, '');
    }
    rows.forEach((r, k) => {
      const c = r?.current;
      if (!c || c.temperature_2m == null || c.relative_humidity_2m == null) return;
      tw[o + k] = Math.round(wetBulb(c.temperature_2m, c.relative_humidity_2m) * 10);
      fzl[o + k] = c.freezing_level_height == null
        ? null
        : Math.round(c.freezing_level_height / 10);
    });
  }

  const filled = tw.filter((v) => v != null).length;
  if (filled < points.length * 0.5) throw new Error('phase grid mostly empty');

  return {
    generated_at: new Date().toISOString(),
    lon_min: LON_MIN, lon_step: LON_STEP, cols: COLS,
    lat_min: LAT_MIN, lat_step: LAT_STEP, rows: ROWS,
    /* tenths of a degree, and tens of metres — small integers keep the
       payload under 4 kB, which matters for something the map waits on. */
    tw,
    fzl,
  };
}

/** The current phase field, cached. Never throws: returns null if unavailable. */
export default async function radarPhase() {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.payload;
  if (inFlight) return inFlight;

  inFlight = build()
    .then((payload) => {
      cache = { at: Date.now(), payload };
      return payload;
    })
    .catch((err) => {
      console.warn('[radar-phase] rebuild failed:', err.message);
      // Stale is fine here — a two-hour-old freezing level is still roughly
      // right, and the alternative is drawing every echo as rain.
      if (cache && Date.now() - cache.at < STALE_MS) return cache.payload;
      return null;
    })
    .finally(() => { inFlight = null; });

  return inFlight;
}
