/* Location Weather's outside feeds (16 Nov 2026, Phase E): what other public bodies say about a place.

     floods   the Environment Agency's flood warnings and alerts within 15 km (England), and SEPA's flood
              warnings for a place in Scotland (Natural Resources Wales needs a key, so Wales has none yet)
     health   UKHSA's heat- and cold-health alerts for the place's English region, when one is in force
     air      DEFRA's daily air quality index (1-10) forecast at its nearest forecast site, within 40 km
     tide     the sea level at the Environment Agency's nearest tide gauge within 12 km (England), the last
              26 hours every 15 minutes
     normal   the Met Office HadUK-Grid 1991-2020 monthly normals for the place's climate district
              (server/data/scenarios/climate-1991-2020.json): the high, the low and the rain

   All keyless. Each is cached for as long as its source changes (minutes to a day), each fails on its
   own to null, and nothing about the reader is sent anywhere: only the place's position, rounded. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineKm } from '../aiw/geometry.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NORMALS = path.join(HERE, '..', 'data', 'scenarios', 'climate-1991-2020.json');

/* ── fetching, with a deadline, and a small cache of promises ── */
async function get(url, { text = false, timeout = 15000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'MyWeatherUK', accept: text ? '*/*' : 'application/json' } });
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
    return text ? await r.text() : await r.json();
  } finally { clearTimeout(timer); }
}
const memo = new Map();
function cached(key, ttlMs, make) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = make();
  memo.set(key, { at: Date.now(), value });
  value.catch(() => { if (memo.get(key)?.value === value) memo.delete(key); });
  if (memo.size > 4000) for (const k of [...memo.keys()].slice(0, 1000)) memo.delete(k);
  return value;
}
const settle = (p) => p.then((v) => v ?? null, () => null);
const cell = (lat, lon, dp = 2) => `${lat.toFixed(dp)},${lon.toFixed(dp)}`;
const decode = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&deg;/g, '°').replace(/&acute;/g, '´').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const plain = (html) => decode(html).replace(/<\/(p|li)>/gi, '. ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/\s+\./g, '.').replace(/([.:])\s*\./g, '$1').trim();
/* an alert's HTML as its paragraphs and its list's points, in order: [{ li: false, text }, ...] */
const htmlLines = (html) => [...decode(html).matchAll(/<(p|li)[^>]*>([\s\S]*?)<\/\1>/gi)]
  .map((m) => ({ li: m[1].toLowerCase() === 'li', text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }))
  .filter((x) => x.text).slice(0, 14);
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]).trim() : null; };
const items = (xml) => [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);

/* ── where the place is: its country and English region (postcodes.io, OS/ONS, kept a week) ── */
function regionOf(lat, lon) {
  return cached(`rg:${cell(lat, lon)}`, 7 * 864e5, async () => {
    const j = await get(`https://api.postcodes.io/postcodes?lon=${lon.toFixed(4)}&lat=${lat.toFixed(4)}&limit=1&widesearch=true`);
    const r = j?.result?.[0];
    return r ? { country: r.country || null, region: r.region || null, district: r.admin_district || null } : null;
  });
}
/* Scotland by its border, for a place postcodes.io cannot place (the hills, the sea) */
function inScotland(lat, lon) {
  if (lat >= 55.82) return lon > -8.5;
  if (lat < 54.6 || lon < -5.35) return false;
  if (lon <= -3.1) return true;
  return lat > 54.95 + (lon + 3.05) * 0.81;                     // the Solway to the Tweed
}

/* ── floods ── */
function eaFloods(lat, lon) {
  return cached(`ea:${cell(lat, lon)}`, 10 * 60e3, async () => {
    const j = await get(`https://environment.data.gov.uk/flood-monitoring/id/floods?lat=${lat.toFixed(4)}&long=${lon.toFixed(4)}&dist=15`);
    return (j.items || []).filter((x) => x.severityLevel >= 1 && x.severityLevel <= 3).map((x) => ({
      level: x.severityLevel,                                    // 1 severe flood warning, 2 flood warning, 3 flood alert
      area: x.description || x.eaAreaName || 'An area near here',
      water: x.floodArea?.riverOrSea || null,
      raised: x.timeRaised || null,
      changed: x.timeMessageChanged || null,
      message: plain(x.message || '').slice(0, 700),
      link: x.floodAreaID ? `https://check-for-flooding.service.gov.uk/target-area/${x.floodAreaID}` : 'https://check-for-flooding.service.gov.uk/',
    })).sort((a, b) => a.level - b.level).slice(0, 6);
  });
}
function sepaFloods() {
  return cached('sepa', 10 * 60e3, async () => {
    const xml = await get('https://floodline.sepa.org.uk/feed/', { text: true });
    return items(xml).map((it) => ({ title: tag(it, 'title'), text: plain(tag(it, 'description') || '').slice(0, 500), link: tag(it, 'link'), at: tag(it, 'pubDate') }))
      .filter((x) => x.title).slice(0, 12);
  });
}

/* ── UKHSA's weather-health alerts for an English region ── */
const UKHSA = 'https://ukhsa-dashboard.data.gov.uk/api/proxy/alerts/v1';
async function healthAlerts(region) {
  if (!region) return [];
  const out = [];
  for (const kind of ['cold', 'heat']) {
    const list = await settle(cached(`uk:${kind}`, 20 * 60e3, () => get(`${UKHSA}/${kind}`)));
    const r = (list || []).find((x) => x.geography_name === region);
    if (!r || !r.status || r.status === 'Green') continue;
    const d = await settle(cached(`uk:${kind}:${r.geography_code}`, 20 * 60e3, () => get(`${UKHSA}/${kind}/${r.geography_code}`)));
    if (!d) continue;
    out.push({
      kind, status: d.status, region: d.geography_name, from: d.period_start || null, to: d.period_end || null,
      likelihood: d.likelihood || null, impact: d.impact || null, lines: htmlLines(d.text || ''),
      link: `https://ukhsa-dashboard.data.gov.uk/weather-health-alerts/${kind}`,
    });
  }
  return out;
}

/* ── DEFRA's air quality forecast: every forecast site, kept an hour ── */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dms(d, m, s, h) { const v = Number(d) + Number(m) / 60 + Number(s) / 3600; return h === 'S' || h === 'W' ? -v : v; }
function airSites() {
  return cached('daqi', 60 * 60e3, async () => {
    const xml = await get('https://uk-air.defra.gov.uk/assets/rss/forecast.xml', { text: true, timeout: 30000 });
    const out = [];
    for (const it of items(xml)) {
      const desc = tag(it, 'description') || '';
      const p = desc.match(/(\d+)°(\d+)´([\d.]+)"([NS])\s+(\d+)°(\d+)´([\d.]+)"([EW])/);
      if (!p) continue;
      const days = [...desc.matchAll(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat):\s*(\d+)/g)].map((m) => ({ dow: m[1], v: Number(m[2]) }));
      if (!days.length) continue;
      out.push({ name: tag(it, 'title'), lat: dms(p[1], p[2], p[3], p[4]), lon: dms(p[5], p[6], p[7], p[8]), pub: tag(it, 'pubDate'), days });
    }
    return out;
  });
}
async function airQuality(lat, lon) {
  const sites = await airSites();
  let best = null, bestKm = Infinity;
  for (const s of sites) { const km = haversineKm(lat, lon, s.lat, s.lon); if (km < bestKm) { bestKm = km; best = s; } }
  if (!best || bestKm > 40) return null;
  /* the forecast's days as dates: the first is the day it was issued (UK time) */
  const issued = best.pub ? new Date(best.pub) : new Date();
  const ukDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  let t = issued.getTime();
  const days = best.days.map((x) => {
    for (let k = 0; k < 7 && DOW[new Date(`${ukDay(new Date(t))}T12:00:00Z`).getUTCDay()] !== x.dow; k++) t += 864e5;
    const day = ukDay(new Date(t));
    t += 864e5;
    return { day, v: x.v };
  });
  return { site: best.name, km: Math.round(bestKm), issued: best.pub, days };
}

/* ── the nearest tide gauge, and its last 26 hours ── */
const EA = 'https://environment.data.gov.uk/flood-monitoring';
async function tideGauge(lat, lon) {
  /* (the stations search is slow, up to 20 s; a place's answer is kept a day) */
  const st = await cached(`tg:${cell(lat, lon, 1)}`, 864e5, () => get(`${EA}/id/stations?lat=${lat.toFixed(3)}&long=${lon.toFixed(3)}&dist=12&parameter=level&qualifier=Tidal%20Level`, { timeout: 30000 }));
  const near = (st.items || []).map((s) => {
    const ms = [].concat(s.measures || []).filter((m) => m.qualifier === 'Tidal Level');
    const m = ms.find((x) => x.unitName === 'mAOD') || ms[0];
    return m && Number.isFinite(s.lat) && Number.isFinite(s.long) ? { name: s.label, km: haversineKm(lat, lon, s.lat, s.long), measure: m['@id'], unit: m.unitName } : null;
  }).filter(Boolean).sort((a, b) => a.km - b.km)[0];
  if (!near) return null;
  const since = new Date(Date.now() - 26 * 36e5).toISOString().slice(0, 19) + 'Z';
  const r = await cached(`tgr:${near.measure}`, 10 * 60e3, () => get(`${near.measure.replace(/^http:/, 'https:')}/readings?_sorted&since=${since}&_limit=400`));
  const pts = (r.items || []).map((x) => [Date.parse(x.dateTime), Number(x.value)]).filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
  if (pts.length < 8) return null;
  return { station: near.name, km: Math.round(near.km * 10) / 10, unit: near.unit === 'mAOD' ? 'm above Ordnance Datum' : near.unit, points: pts };
}

/* ── the place's 1991-2020 normals (Met Office HadUK-Grid climate districts) ── */
let normals = null;
function normalsFile() {
  if (!normals) { try { normals = JSON.parse(fs.readFileSync(NORMALS, 'utf8')); } catch { normals = { series: {} }; } }
  return normals;
}
function districtOf(lat, lon, where) {
  const country = where?.country || (inScotland(lat, lon) ? 'Scotland' : null);
  if (country === 'Scotland') return lat >= 57 ? (lon < -2.8 ? 'Scotland_N' : 'Scotland_E') : lat < 55.6 ? (lon < -3.3 ? 'Scotland_W' : 'Scotland_E') : lon > -3.7 ? 'Scotland_E' : 'Scotland_W';
  if (country === 'Northern Ireland') return 'Northern_Ireland';
  if (country === 'Wales') return lat < 52.3 ? 'England_SW_and_S_Wales' : 'England_NW_and_N_Wales';
  const byRegion = {
    London: 'England_SE_and_Central_S', 'South East': 'England_SE_and_Central_S', 'South West': 'England_SW_and_S_Wales',
    'East of England': 'East_Anglia', 'East Midlands': 'Midlands', 'West Midlands': 'Midlands',
    'North East': 'England_E_and_NE', 'Yorkshire and The Humber': 'England_E_and_NE', 'North West': 'England_NW_and_N_Wales',
  };
  return byRegion[where?.region] || (country === 'England' ? 'England' : null);
}
function normalFor(lat, lon, where) {
  const key = districtOf(lat, lon, where);
  const s = key && normalsFile().series?.[key];
  if (!s) return null;
  const m = (v) => s.vars?.[v]?.months || null;
  return { district: key, name: s.name || key.replace(/_/g, ' '), period: normalsFile().period || '1991–2020', tmax: m('Tmax'), tmin: m('Tmin'), rain: m('Rainfall') };
}

/** Everything outside for a place; each part null (or empty) when its source has nothing or fails. */
export async function outsideAt(lat, lon) {
  const where = await settle(regionOf(lat, lon));
  const scot = where?.country ? where.country === 'Scotland' : inScotland(lat, lon);
  const england = where?.country ? where.country === 'England' : !scot && lat < 55.9 && lon > -5.8;
  const [ea, sepa, health, air, tide] = await Promise.all([
    england ? settle(eaFloods(lat, lon)) : null,
    scot ? settle(sepaFloods()) : null,
    where?.country === 'England' ? settle(healthAlerts(where.region)) : null,
    settle(airQuality(lat, lon)),
    england ? settle(tideGauge(lat, lon)) : null,
  ]);
  return {
    where: where ? { country: where.country, region: where.region } : null,
    floods: ea?.length || sepa?.length ? { england: ea || [], scotland: sepa || [] } : null,
    health: health?.length ? health : null,
    air,
    tide,
    normal: normalFor(lat, lon, where),
  };
}

/** GET /api/location/outside?lat=&lon= */
export function mountOutside(app) {
  /* the shared feeds read ahead and kept warm, so no reader waits for the 1.7 MB air quality forecast */
  const warm = () => { settle(airSites()); settle(cached('uk:cold', 20 * 60e3, () => get(`${UKHSA}/cold`))); settle(cached('uk:heat', 20 * 60e3, () => get(`${UKHSA}/heat`))); };
  setTimeout(warm, 20e3);
  setInterval(warm, 20 * 60e3).unref?.();
  const answers = new Map();                                       // per 0.01° cell, five minutes
  app.get('/api/location/outside', async (req, res) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 48 || lat > 62 || lon < -12 || lon > 4) return res.status(400).json({ error: 'lat and lon in the UK and Ireland, please' });
    const key = cell(lat, lon);
    const hit = answers.get(key);
    try {
      const body = hit && Date.now() - hit.at < 5 * 60e3 ? hit.body : await outsideAt(lat, lon);
      if (!hit || hit.body !== body) { answers.set(key, { at: Date.now(), body }); if (answers.size > 3000) answers.delete(answers.keys().next().value); }
      res.set('Cache-Control', 'public, max-age=120');
      res.json(body);
    } catch (e) {
      res.status(502).json({ error: e?.message || 'The outside feeds could not be read' });
    }
  });
}
