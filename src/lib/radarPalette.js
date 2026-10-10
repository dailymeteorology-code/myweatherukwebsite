/* ════════════════════════════════════════════════════════════════════════════
   RADAR PALETTE — EXACT dBZ, AND RAIN vs SNOW
   ────────────────────────────────────────────────────────────────────────────
   RainViewer's public tier serves ONE fixed colour palette ("Universal Blue",
   scheme 2): the `color` parameter in the tile URL is accepted and then
   ignored, so schemes 0 through 8 return byte-identical PNGs. The only way to
   recover what the radar measured is to decode the palette it actually sends.

   That palette is PUBLISHED — 256 rows, dBZ −32 to 95, the first 128 for rain
   and the second 128 for snow (tiles are requested with the snow option on).
   Both halves are reproduced below, so a pixel is decoded to an exact dBZ and
   an exact phase rather than being estimated.

   TWO EARLIER VERSIONS WERE WRONG, IN DIFFERENT WAYS.

   The first inferred intensity from luminance and saturation. Checked against
   the real ramp that ran BACKWARDS across 24 of its 72 steps: magenta, the most
   intense return a radar produces, scored 0.48 while an ordinary mid-blue
   scored 0.86.

   The second grouped the colours into five families by hand and interpolated
   inside each. Better, but it folded the SNOW half of the palette into the rain
   families — so falling snow was drawn as though it were rain, and the fact
   that the tile had already told us it was snow was thrown away. The 77 rain
   colours and 85 snow colours share not one RGBA value between them, so the
   distinction was there for free the whole time.

   dBZ is the honest unit here: it is what the radar reports. Rainfall rates in
   the legend come from Marshall–Palmer (Z = 200·R^1.6) and are indicative, as
   they are on every radar that prints them.
   ════════════════════════════════════════════════════════════════════════════ */

/* RainViewer "Universal Blue", 128 entries each, RRGGBBAA, dBZ = index − 32.
   Verbatim from their published colour table. */
const RAIN_HEX =
  '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' +
  '000000000000000000000000000000000000000000000000000000006361591466635a1969665c1e6c685d246f6b5f29726e612e7570623478736439' +
  '7c75653e7f786744827b6949857d6a4e88806c548b826d598e856f5e928871649e93756eaa9e7978b6a97e82c2b4828ccec08796d2c48ba0d6c88faa' +
  'dacc93b4ded097be88ddeeff6cd1ebff51c5e8ff36bae5ff1baee2ff00a3e0ff009ad5ff0091caff0088bfff007fb4ff0077aaff0070a3ff00699cff' +
  '006295ff005b8eff005588ff005180ff004e78ff004a70ff004768ffffee00ffffe000ffffd200ffffc500ffffb700ffffaa00ffff9f00ffff9500ff' +
  'ff8b00ffff8100ffff4400fff23600ffe62800ffd91b00ffcd0d00ffc10000ffa80000ff8f0000ff760000ff5d0000ffffaaffffff9fffffff95ffff' +
  'ff8bffffff81ffffff77ffffff6cffffff62ffffff58ffffff4effffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' +
  'ffffffffffffffff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff' +
  '00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff';

const SNOW_HEX =
  '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' +
  '00000000000000000000000000000000000000000000000000000000cfffff00ceffff0ccdffff19ccffff26cbffff33cbffff3fcaffff4cc9ffff59' +
  'c8ffff66c7ffff72c7ffff7fc6ffff8cc5ffff99c4ffffa5c3ffffb2c3ffffbfc2ffffccc1ffffd8c0ffffe5bffffff2bfffffffb8f8ffffb2f2ffff' +
  'abebffffa5e5ffff9fdfffff98d8ffff92d2ffff8bcbffff85c5ffff7fbfffff78b8ffff72b2ffff6babffff65a5ffff5f9fffff5b9bffff5898ffff' +
  '5595ffff5292ffff4f8fffff4b8bffff4888ffff4585ffff4282ffff3f7fffff3b7bffff3878ffff3575ffff3272ffff2f6fffff2b6bffff2868ffff' +
  '2565ffff2262ffff1f5fffff1b5bffff1858ffff1555ffff1252ffff0f4fffff0c4bffff0948ffff0645ffff0242ffff003fffff003bffff0038ffff' +
  '0035ffff0032ffff002fffff002bffff0028ffff0025ffff0022ffff001fffff001bffff0018ffff0015ffff0012ffff000fffff000cffff0009ffff' +
  '0006ffff0002ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff' +
  '0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff';

/* Below −32 the table is empty; above 74 dBZ it repeats a sentinel colour
   rather than carrying data, so that is where the scale stops. */
const DBZ_MIN = -32;
const DBZ_TOP = 74;

export const PHASE = { RAIN: 0, MIX: 1, SNOW: 2, ICE: 3 };

/* packed RGBA → (dBZ − DBZ_MIN) | SNOW_BIT. Built once; ~160 entries. */
const SNOW_BIT = 0x200;
const LOOKUP = new Map();
(function buildLookup() {
  const add = (hex, i, bit) => {
    const a = parseInt(hex.slice(6, 8), 16);
    if (a === 0) return;                       // fully transparent carries nothing
    const packed = (parseInt(hex.slice(0, 6), 16) * 256 + a) >>> 0;
    if (!LOOKUP.has(packed)) LOOKUP.set(packed, i | bit);   // lowest dBZ wins a repeat
  };
  for (let i = 0; i <= DBZ_TOP - DBZ_MIN; i += 1) {
    add(RAIN_HEX.substr(i * 8, 8), i, 0);
    add(SNOW_HEX.substr(i * 8, 8), i, SNOW_BIT);
  }
})();

/**
 * What the radar reported at this pixel: its reflectivity in dBZ and whether
 * the tile drew it as snow. Returns null for transparent pixels and for
 * anything outside the published palette.
 */
export function decode(r, g, b, a) {
  if (a === 0) return null;
  const hit = LOOKUP.get((((r << 16) | (g << 8) | b) * 256 + a) >>> 0);
  if (hit === undefined) return null;
  return { dbz: (hit & 0x1ff) + DBZ_MIN, snow: (hit & SNOW_BIT) !== 0 };
}

/* ── Ramps ───────────────────────────────────────────────────────────────────
   Rain runs green → yellow → orange → red → magenta → white, the scheme every
   public radar uses, so intensity is legible before anyone reads the legend.
   Blue is deliberately absent from it: blue belongs to snow.

   Phase follows the same convention forecasters use on television — rain in
   the reflectivity ramp, snow in blues, sleet in pinks, freezing rain in
   purples — so the four are distinguishable at a glance and, importantly,
   distinguishable in greyscale by lightness as well as by hue.

   Stops are [dBZ, '#rrggbb']; anything between them is interpolated. */
export const RAMPS = {
  rain: [
    [5, '#c9f7b0'], [10, '#8ee87f'], [15, '#41d641'], [20, '#0fb80f'],
    [25, '#0a8f18'], [30, '#e9e335'], [35, '#f7c928'], [40, '#f79325'],
    [45, '#ef5a22'], [50, '#dc1f1f'], [55, '#a80d0d'], [60, '#e83ae8'],
    [65, '#a92fd6'], [70, '#f2f2f2'], [74, '#ffffff'],
  ],
  snow: [
    [5, '#e6f7ff'], [15, '#b7e2ff'], [25, '#77c2ff'], [35, '#3f95f2'],
    [45, '#2a5fd6'], [55, '#5a35c0'], [74, '#c9b6ff'],
  ],
  mix: [
    [5, '#ffe0f0'], [15, '#ffb0d8'], [25, '#ff77bd'], [35, '#ef3f9c'],
    [45, '#c8127a'], [55, '#8c0053'], [74, '#f5a8d2'],
  ],
  ice: [
    [5, '#efe0ff'], [15, '#d5b8ff'], [25, '#b487ff'], [35, '#8f4ff0'],
    [45, '#6b21c9'], [55, '#48168c'], [74, '#d9c2ff'],
  ],
};

const PHASE_KEY = ['rain', 'mix', 'snow', 'ice'];

/** The colour a ramp gives at a reflectivity, as [r, g, b]. */
export function rampColour(key, dbz) {
  const stops = RAMPS[key] || RAMPS.rain;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  if (dbz <= stops[0][0]) return hex(stops[0][1]);
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [d0, c0] = stops[i];
    const [d1, c1] = stops[i + 1];
    if (dbz <= d1) {
      const f = (dbz - d0) / (d1 - d0 || 1);
      const a = hex(c0); const b = hex(c1);
      return [
        Math.round(a[0] + (b[0] - a[0]) * f),
        Math.round(a[1] + (b[1] - a[1]) * f),
        Math.round(a[2] + (b[2] - a[2]) * f),
      ];
    }
  }
  return hex(stops[stops.length - 1][1]);
}

/* Below this the return is noise or clutter as often as it is precipitation,
   and drawing it turns the map into static. */
export const DBZ_FLOOR = 5;
const FADE_TO = 18;               // fully opaque by here; a soft edge below it

/**
 * A lookup of every phase at every dBZ: 4 × 128 × 4 bytes (r, g, b, a).
 * Indexed as ((phase * 128) + (dbz − DBZ_MIN)) * 4.
 */
export function buildPhaseLUT() {
  const lut = new Uint8Array(4 * 128 * 4);
  for (let p = 0; p < 4; p += 1) {
    for (let i = 0; i < 128; i += 1) {
      const dbz = i + DBZ_MIN;
      const o = (p * 128 + i) * 4;
      if (dbz < DBZ_FLOOR) continue;                       // left at 0,0,0,0
      const [r, g, b] = rampColour(PHASE_KEY[p], Math.min(dbz, DBZ_TOP));
      lut[o] = r; lut[o + 1] = g; lut[o + 2] = b;
      lut[o + 3] = dbz >= FADE_TO
        ? 255
        : Math.round(90 + (255 - 90) * ((dbz - DBZ_FLOOR) / (FADE_TO - DBZ_FLOOR)));
    }
  }
  return lut;
}

/** Index into the LUT above. */
export const lutIndex = (phase, dbz) =>
  (phase * 128 + Math.min(127, Math.max(0, Math.round(dbz) - DBZ_MIN))) * 4;

/* ── Legend ──────────────────────────────────────────────────────────────────
   Rainfall rates are Marshall–Palmer for rain; for snow the same reflectivity
   means far less water, so the ramp is labelled by how it looks rather than by
   a rate that would be misleading. */
export const RAIN_BANDS = [
  { dbz: 5, mmh: '0.1', label: 'Trace' },
  { dbz: 15, mmh: '0.3', label: 'Very light' },
  { dbz: 20, mmh: '0.6', label: 'Light' },
  { dbz: 25, mmh: '1.3', label: 'Light–moderate' },
  { dbz: 30, mmh: '2.7', label: 'Moderate' },
  { dbz: 35, mmh: '6', label: 'Heavy' },
  { dbz: 40, mmh: '12', label: 'Very heavy' },
  { dbz: 45, mmh: '26', label: 'Torrential' },
  { dbz: 50, mmh: '55', label: 'Intense' },
  { dbz: 55, mmh: '117', label: 'Extreme' },
  { dbz: 60, mmh: '205', label: 'Hail likely' },
  { dbz: 65, mmh: '—', label: 'Large hail' },
];

export const PHASE_LABEL = ['Rain', 'Sleet', 'Snow', 'Freezing'];

/** Plain-language description of a decoded sample, for the tap-to-read panel. */
export function describe(dbz, phase) {
  if (dbz == null || dbz < DBZ_FLOOR) return 'No precipitation';
  let band = RAIN_BANDS[0];
  for (const b of RAIN_BANDS) if (dbz >= b.dbz) band = b;
  if (phase === PHASE.SNOW) return `${band.label} snow`;
  if (phase === PHASE.MIX) return `${band.label} sleet`;
  if (phase === PHASE.ICE) return `${band.label} freezing rain`;
  return `${band.label} rain`;
}

/** Rainfall rate for a reflectivity, Marshall–Palmer. Rain only. */
export function rateFor(dbz) {
  if (dbz == null || dbz < DBZ_FLOOR) return null;
  return Math.pow(Math.pow(10, dbz / 10) / 200, 1 / 1.6);
}
