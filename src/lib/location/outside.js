/* Location Weather's outside feeds on the page (16 Nov 2026, Phase E): flood warnings, UKHSA's
   weather-health alerts, DEFRA's air quality forecast, the nearest tide gauge and the 1991-2020 normals,
   from server/location/outside.js; and the words comparing a day with yesterday and with normal. */

export async function fetchOutside(lat, lon, signal) {
  const r = await fetch(`/api/location/outside?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, { signal });
  if (!r.ok) throw new Error(`The outside feeds answered ${r.status}`);
  return r.json();
}

/* DEFRA's daily air quality index, 1 to 10, in its own bands and colours */
export const DAQI_COLOURS = [null, '#9cff9c', '#31ff00', '#31cf00', '#ffff00', '#ffcf00', '#ff9a00', '#ff6464', '#ff0000', '#990000', '#ce30ff'];
export const daqiWord = (v) => (v == null ? null : v <= 3 ? 'Low' : v <= 6 ? 'Moderate' : v <= 9 ? 'High' : 'Very high');
export const DAQI_ADVICE = {
  Low: 'Enjoy your usual outdoor activities.',
  Moderate: 'Adults and children with lung problems, and adults with heart problems, who feel unwell should consider doing less strenuous activity, particularly outdoors.',
  High: 'Anyone with lung or heart problems should reduce strenuous effort, particularly outdoors; anyone with sore eyes, a cough or a sore throat should consider doing less outdoors.',
  'Very high': 'Everyone should reduce physical exertion outdoors, particularly anyone with lung or heart problems or who experiences symptoms.',
};

/* the flood warning levels, as the Environment Agency names and colours them */
export const FLOOD_LEVELS = {
  1: { name: 'Severe flood warning', colour: '#c8102e', ink: '#fff', words: 'Severe flooding: danger to life' },
  2: { name: 'Flood warning', colour: '#e4002b', ink: '#fff', words: 'Flooding is expected: act now' },
  3: { name: 'Flood alert', colour: '#f47738', ink: '#1b1300', words: 'Flooding is possible: be prepared' },
};
export const HEALTH_COLOURS = { Yellow: ['#ffd426', '#1b1300'], Amber: ['#f5a623', '#1b1300'], Red: ['#e23b3b', '#fff'] };

/** The district's normal high and low (°C) and its month's rain (mm) on a day (ms): each month's normal
    belongs to its middle, and the days between are drawn between two months. */
export function normalOn(normal, t = Date.now()) {
  if (!normal?.tmax || !normal?.tmin) return null;
  const d = new Date(t);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', month: 'numeric', day: 'numeric', year: 'numeric' }).formatToParts(d);
  const v = (k) => Number(parts.find((p) => p.type === k)?.value);
  const y = v('year'), m = v('month') - 1, day = v('day');
  const len = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const x = m + (day - 0.5 - len / 2) / len;                       // the year in months, from the middle of January
  const a = Math.floor(x), f = x - a;
  const at = (arr, i) => arr[((i % 12) + 12) % 12];
  const lerp = (arr) => at(arr, a) + (at(arr, a + 1) - at(arr, a)) * f;
  return { hi: lerp(normal.tmax), lo: lerp(normal.tmin), rain: normal.rain ? at(normal.rain, m) : null, district: normal.name, period: normal.period };
}

/** A temperature difference (°C) in the reader's scale, rounded: 3 (°C) is 5 in °F. */
const diffIn = (d, U) => Math.round(U?.isF ? (d * 9) / 5 : d);

/** "2° colder than yesterday · 3° below normal": today's high against yesterday's observed high and the
    district's normal high for the date; either half left out when it has nothing to compare. For another
    day (time travel): that day against its normal only. */
export function compareWords({ hi, yesterdayHi = null, normal = null, day = Date.now(), U }) {
  if (hi == null) return null;
  const out = [];
  if (yesterdayHi != null) {
    const d = diffIn(hi - yesterdayHi, U);
    out.push(d === 0 ? 'Much the same as yesterday' : `${Math.abs(d)}° ${d > 0 ? 'warmer' : 'colder'} than yesterday`);
  }
  const n = normalOn(normal, day);
  if (n) {
    const d = diffIn(hi - n.hi, U);
    out.push(Math.abs(d) <= 1 ? 'about normal for the time of year' : `${Math.abs(d)}° ${d > 0 ? 'above' : 'below'} normal`);
  }
  if (!out.length) return null;
  const s = out.join(' · ');
  return s[0].toUpperCase() + s.slice(1);
}

/** The tide gauge's level now, which way it is going, and its last high and low water. */
export function tideNow(tide) {
  const p = tide?.points;
  if (!p || p.length < 8) return null;
  const [t, v] = p[p.length - 1];
  const back = p.find(([tt]) => tt >= t - 45 * 60e3) || p[p.length - 3];
  const rate = (v - back[1]) / Math.max(0.25, (t - back[0]) / 36e5);                 // m per hour
  /* turning points: a reading higher (lower) than the hour either side of it */
  const turns = [];
  for (let i = 2; i < p.length - 2; i++) {
    const w = p.slice(Math.max(0, i - 4), Math.min(p.length, i + 5)).map((x) => x[1]);
    if (p[i][1] === Math.max(...w) && p[i][1] > p[i - 1][1]) turns.push({ kind: 'high', t: p[i][0], v: p[i][1] });
    else if (p[i][1] === Math.min(...w) && p[i][1] < p[i - 1][1]) turns.push({ kind: 'low', t: p[i][0], v: p[i][1] });
  }
  const last = (k) => [...turns].reverse().find((x) => x.kind === k) || null;
  return { t, v, rising: rate > 0.05, falling: rate < -0.05, rate, high: last('high'), low: last('low') };
}
