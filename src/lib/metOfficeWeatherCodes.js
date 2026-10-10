/* Met Office significantWeatherCode → description + a key from the shared icon
 * library (components/WeatherIcons.jsx).
 *
 * THE `icon` VALUES MUST MATCH THE LIBRARY EXACTLY, including capitalisation.
 * They once did not — the library is keyed 'Sunny', 'Partly Cloudy',
 * 'Rain Shower' while this table asked for 'sunny', 'partly cloudy',
 * 'light rain shower'. Every lookup came back undefined, so every forecast on
 * the page — sunny, snow, thunder alike — drew the same grey cloud. All 19 keys
 * missed, and it looked plausible the whole time.
 *
 * Met Office encodes day and night in the code itself: within a shower family
 * the even code is night and the odd one is day (9 night / 10 day, 13/14,
 * 16/17, and so on), so the pairs are mapped separately and a 2am shower gets
 * a moon rather than a sun.
 *
 * Shared, so the forecast page and the eclipse card cannot drift apart on what
 * a code means.
 */
export const WEATHER_CODES = {
  0:  { desc: 'Clear night',        icon: 'Clear Night' },
  1:  { desc: 'Sunny',              icon: 'Sunny' },
  2:  { desc: 'Partly cloudy',      icon: 'Partly Cloudy Night' },
  3:  { desc: 'Partly cloudy',      icon: 'Partly Cloudy' },
  5:  { desc: 'Mist',               icon: 'Mist' },
  6:  { desc: 'Fog',                icon: 'Fog' },
  7:  { desc: 'Cloudy',             icon: 'Cloudy' },
  8:  { desc: 'Overcast',           icon: 'Overcast' },
  9:  { desc: 'Light rain shower',  icon: 'Rain Shower Night' },
  10: { desc: 'Light rain shower',  icon: 'Rain Shower' },
  11: { desc: 'Drizzle',            icon: 'Drizzle' },
  12: { desc: 'Light rain',         icon: 'Light Rain' },
  13: { desc: 'Heavy rain shower',  icon: 'Heavy Showers Night' },
  14: { desc: 'Heavy rain shower',  icon: 'Heavy Showers' },
  15: { desc: 'Heavy rain',         icon: 'Heavy Rain' },
  16: { desc: 'Sleet shower',       icon: 'Sleet Night' },
  17: { desc: 'Sleet shower',       icon: 'Sleet' },
  18: { desc: 'Sleet',              icon: 'Sleet' },
  19: { desc: 'Hail shower',        icon: 'Hail Night' },
  20: { desc: 'Hail shower',        icon: 'Hail' },
  21: { desc: 'Hail',               icon: 'Hail' },
  22: { desc: 'Light snow shower',  icon: 'Flurry Night' },
  23: { desc: 'Light snow shower',  icon: 'Flurry' },
  24: { desc: 'Light snow',         icon: 'Light Snow' },
  25: { desc: 'Heavy snow shower',  icon: 'Heavy Snow Night' },
  26: { desc: 'Heavy snow shower',  icon: 'Heavy Snow' },
  27: { desc: 'Heavy snow',         icon: 'Heavy Snow' },
  28: { desc: 'Thunder shower',     icon: 'Thundery Shower Night' },
  29: { desc: 'Thunder shower',     icon: 'Thundery Shower' },
  30: { desc: 'Thunder',            icon: 'Thunderstorms' },
};

/* 'Cloudy', capitalised: the fallback has to be a real library key too, or an
   unrecognised code silently loses its symbol the same way. */
export const FALLBACK_CODE = { desc: 'Unknown', icon: 'Cloudy' };

export const codeInfo = (code) => WEATHER_CODES[code] || FALLBACK_CODE;

/** Which precipitation an hour is offering, from its weather code. */
export function precipKind(code) {
  if (code == null) return null;
  if ([28, 29, 30].includes(code)) return 'Thunderstorm';
  if ([19, 20, 21].includes(code)) return 'Hail';
  if ([22, 23, 24, 25, 26, 27].includes(code)) return 'Snow';
  if ([16, 17, 18].includes(code)) return 'Sleet';
  if ([9, 10, 11, 12, 13, 14, 15].includes(code)) return 'Rain';
  return null;
}
