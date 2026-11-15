/* Storm tools for Location Weather (15 Nov 2026, Phase C): lightning near the place, the heavy rain
   coming its way, the AI lightning warning, the kind of storms the atmosphere favours and their hail,
   and what changed since the last UKV run. The server gives the facts (server/locationWeather.js
   /api/location/lightning, /storm, /changes; /api/aiw/check); this puts them in plain words. */
import { hhmm, ukDay, dayLabel } from '@/lib/ukvLocation';
import { when } from '@/lib/location/situations';

export const fetchJson = async (url, signal) => {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};
export const lightningNear = (lat, lon, signal) => fetchJson(`/api/location/lightning?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, signal);
export const stormNear = (lat, lon, signal) => fetchJson(`/api/location/storm?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, signal);
export const aiwCheck = (lat, lon, signal) => fetchJson(`/api/aiw/check?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, signal);
export const runChanges = (lat, lon, signal) => fetchJson(`/api/location/changes?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, signal);

const COMPASS8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const dir8 = (deg) => COMPASS8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/* ── lightning: [minutes ago, km, bearing] within 60 km in the last hour ── */
export function lightningSummary(l) {
  const s = l?.strikes || [];
  if (!s.length) return null;
  const recent = s.filter((x) => x[0] <= 15), before = s.filter((x) => x[0] > 15 && x[0] <= 30);
  const near = recent.reduce((a, b) => (!a || b[1] < a[1] ? b : a), null);
  const median = (xs) => { const v = xs.map((x) => x[1]).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const m1 = median(recent), m2 = median(before);
  const trend = recent.length >= 3 && before.length >= 3 ? (m1 < m2 - 3 ? 'closer' : m1 > m2 + 3 ? 'away' : 'steady') : null;
  return { total: l.total ?? s.length, last: s[0], near, recent: recent.length, before: before.length, trend, danger: !!near && near[1] <= 10 };
}

/* ── the storms the atmosphere favours (CAPE: the energy for them; deep wind shear: how organised they
   get) and the hail they could bring (more CAPE, more shear, a lower freezing level, bigger hail) ── */
export function stormType(cape, shearKmh) {
  if (cape == null || cape < 100 || shearKmh == null) return null;
  const kt = shearKmh / 1.852;
  if (kt >= 40 && cape >= 500) return { type: 'Supercells possible', words: 'strong wind shear could organise storms into long-lived, rotating cells' };
  if (kt >= 20) return { type: 'Clusters or lines of storms', words: 'moderate wind shear: storms in clusters or lines that last longer' };
  return { type: 'Short-lived storms', words: 'weak wind shear: single storms that grow and die away within an hour' };
}
const HAIL = ['Small hail, under 1 cm', 'Hail 1 to 2 cm', 'Large hail, 2 to 4 cm, possible', 'Very large hail, over 4 cm, possible'];
export function hailSize(cape, shearKmh, frz) {
  if (cape == null || cape < 150) return null;
  let band = cape < 400 ? 0 : cape < 1000 ? 1 : cape < 2000 ? 2 : 3;
  if ((shearKmh ?? 0) / 1.852 >= 40 && cape >= 800) band = Math.min(3, band + 1);
  if ((frz ?? 0) > 3500) band = Math.max(0, band - 1);
  return HAIL[band];
}

/* ── what changed: the newest UKV run against the one before, here, from now ── */
const runLabel = (iso) => `${String(new Date(iso).getUTCHours()).padStart(2, '0')}Z`;
export function changeWords(ch, U) {
  if (!ch?.now?.length || !ch?.before?.length) return null;
  const prev = runLabel(ch.prev.run), cur = runLabel(ch.cur.run);
  const items = [];
  const wet = (h) => (h.precip ?? 0) >= (h.span > 1 ? 0.5 : 0.2);
  const a = ch.now.find(wet), b = ch.before.find(wet);
  if (a && b && Math.abs(a.t - b.t) >= 2 * 36e5) items.push(`Rain now from about ${when(a.t)}, ${a.t > b.t ? 'later' : 'sooner'} than the ${prev} run's ${hhmm(b.t)}`);
  else if (a && !b) items.push(`Rain now in the forecast from about ${when(a.t)}; the ${prev} run had it dry`);
  else if (!a && b) items.push(`The rain the ${prev} run had from about ${when(b.t)} is no longer in the forecast`);
  const byDay = (xs) => { const m = new Map(); for (const h of xs) { const d = ukDay(h.t); if (!m.has(d)) m.set(d, []); m.get(d).push(h); } return m; };
  const A = byDay(ch.now), B = byDay(ch.before);
  const deg = (c) => `${Math.round(U.temp(c))}${U.tempUnit}`;
  for (const [d, ha] of A) {
    const hb = B.get(d);
    if (!hb || ha.length < 6 || hb.length < 6) continue;
    const label = dayLabel(d);
    const max = (xs, k) => Math.max(...xs.map((h) => h[k] ?? -99)), min = (xs, k) => Math.min(...xs.map((h) => h[k] ?? 99));
    const sum = (xs, k) => xs.reduce((s, h) => s + (h[k] ?? 0), 0);
    const hiA = max(ha, 't2'), hiB = max(hb, 't2'), loA = min(ha, 't2'), loB = min(hb, 't2');
    if (Math.abs(hiA - hiB) >= 2) items.push(`${label}: ${hiA > hiB ? 'warmer' : 'colder'}, a high of ${deg(hiA)}, not ${deg(hiB)}`);
    else if (Math.abs(loA - loB) >= 2) items.push(`${label}: ${loA > loB ? 'milder' : 'colder'} at its coldest, ${deg(loA)}, not ${deg(loB)}`);
    const rA = sum(ha, 'precip'), rB = sum(hb, 'precip');
    if (Math.abs(rA - rB) >= 4 && Math.max(rA, rB) >= 1.5 * Math.min(rA, rB) + 1) items.push(`${label}: ${rA > rB ? 'wetter' : 'drier'}, ${U.fmtRain(rA, 0)} of rain, not ${U.fmtRain(rB, 0)}`);
    const gA = max(ha, 'gust'), gB = max(hb, 'gust');
    if (Math.abs(gA - gB) >= 10) items.push(`${label}: ${gA > gB ? 'windier' : 'less windy'}, gusts to ${U.fmtWind(gA)}, not ${U.fmtWind(gB)}`);
    const sA = sum(ha, 'snow'), sB = sum(hb, 'snow');
    if ((sA >= 1) !== (sB >= 1)) items.push(sA >= 1 ? `${label}: snow now in the forecast` : `${label}: the snow the ${prev} run had is gone`);
  }
  return { prev, cur, items: items.slice(0, 5) };
}
export { when };
