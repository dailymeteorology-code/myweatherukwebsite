/* TCM NOVA's thunderstorm risk at one place, hour by hour, for the Location page.

   NOVA (server/tcmNova.js runs or mirrors it into D:/TCM-NOVA/data) has two products:
   - the Hyper-Short: every hour, 24 h ahead in 30-minute frames at 1.5 km. The radar and the
     lightning carried forward, handed over to TCM V5 on the latest UKV as the nowcast fades
     (its own manifest: the two weigh equally after about an hour, the nowcast is gone by ~6 h);
   - the Main Run: four times a day, 96 h in 3-hour frames at 2 km, seven models through TCM V5.
   So an hour takes the Hyper-Short up to 4 h ahead, the Main Run from 7 h, and a blend between,
   moving from one to the other. A Hyper-Short hour is the highest of its frames within half an
   hour; a Main Run hour between two frames lies on the line between them.

   p_thunder is the chance of a thunderstorm within the frame's neighbourhood: 3 km at the start
   of the Hyper-Short, 10 km plus 0.35 km an hour of lead in the Main Run (the placement error
   grows). The value here is the mean of the 3 x 3 cells round the place. NOVA's probabilities
   are not calibrated yet; the page says so.

   This reads NOVA's files directly, so /api/nova stays admin-only. Fields are zlib-compressed
   float16 on the British National Grid (lower-left corner at x0, y0; row 0 = south). */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.NOVA_DATA || (fs.existsSync('D:/') ? 'D:/TCM-NOVA/data' : path.join(here, 'data', 'tcm-nova'));
const HOUR = 3600e3;
const HYPER_ONLY_H = 4, MAIN_ONLY_H = 7;                // the hand-over, hours after the Hyper-Short's start
const HYPER_STALE_H = 3, MAIN_STALE_H = 18;              // older runs than this are left out
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/* ── British National Grid (Airy 1830 transverse Mercator; WGS84 taken as OSGB36, ~100 m out,
   far below the cells) ── */
const D = Math.PI / 180;
const A = 6377563.396, B = 6356256.909, F0 = 0.9996012717, LAT0 = 49 * D, LON0 = -2 * D;
const N0 = -100000, E0 = 400000, E2 = 1 - (B * B) / (A * A), NN = (A - B) / (A + B);
function meridional(p) {
  const dp = p - LAT0, sp = p + LAT0, n = NN;
  return B * F0 * ((1 + n + 1.25 * n * n + 1.25 * n ** 3) * dp - (3 * n + 3 * n * n + 2.625 * n ** 3) * Math.sin(dp) * Math.cos(sp)
    + (1.875 * n * n + 1.875 * n ** 3) * Math.sin(2 * dp) * Math.cos(2 * sp) - (35 / 24) * n ** 3 * Math.sin(3 * dp) * Math.cos(3 * sp));
}
/** [lat, lon] degrees -> BNG [easting, northing] m (the Ordnance Survey's forward formulae). */
export function toBNG(lat, lon) {
  const p = lat * D, sp = Math.sin(p), cp = Math.cos(p), tp = Math.tan(p);
  const nu = (A * F0) / Math.sqrt(1 - E2 * sp * sp), rho = (A * F0 * (1 - E2)) / (1 - E2 * sp * sp) ** 1.5, eta2 = nu / rho - 1;
  const I = meridional(p) + N0, II = (nu / 2) * sp * cp, III = (nu / 24) * sp * cp ** 3 * (5 - tp * tp + 9 * eta2);
  const IIIA = (nu / 720) * sp * cp ** 5 * (61 - 58 * tp * tp + tp ** 4);
  const IV = nu * cp, V = (nu / 6) * cp ** 3 * (nu / rho - tp * tp), VI = (nu / 120) * cp ** 5 * (5 - 18 * tp * tp + tp ** 4 + 14 * eta2 - 58 * tp * tp * eta2);
  const dl = lon * D - LON0;
  return [E0 + IV * dl + V * dl ** 3 + VI * dl ** 5, I + II * dl ** 2 + III * dl ** 4 + IIIA * dl ** 6];
}

function f16(u) {
  const s = u & 0x8000 ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/* the newest published run of a product, with its manifest */
const runCache = new Map();
function latest(product) {
  const id = readJson(path.join(DATA, product, 'latest.json'))?.run_id;
  if (!id || !/^[a-z]+-\d{8}T\d{4}Z$/.test(id)) return null;
  if (runCache.get(product)?.id !== id) {
    const m = readJson(path.join(DATA, product, id, 'manifest.json'));
    if (!m?.frames?.length || !m.grid) return null;
    runCache.set(product, { id, m, init: Date.parse(m.init_utc) });
  }
  return runCache.get(product);
}

/* frames, inflated once and kept (a Hyper-Short field is 1 MB, a Main Run field 0.6 MB) */
const frames = new Map();
function field(product, id, leadMin, name) {
  const file = path.join(DATA, product, id, 'frames', String(leadMin), `${name}.bin`);
  if (frames.has(file)) { const b = frames.get(file); frames.delete(file); frames.set(file, b); return b; }
  let buf = null;
  try { buf = zlib.inflateSync(fs.readFileSync(file)); } catch { buf = null; }
  frames.set(file, buf);
  while (frames.size > 90) frames.delete(frames.keys().next().value);
  return buf;
}
/* the mean of the 3 x 3 cells round (i, j), NaN left out */
function at(buf, g, i, j) {
  if (!buf) return null;
  let s = 0, n = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const x = i + di, y = j + dj;
      if (x < 0 || y < 0 || x >= g.nx || y >= g.ny) continue;
      const v = f16(buf.readUInt16LE((y * g.nx + x) * 2));
      if (v === v) { s += v; n++; }
    }
  }
  return n ? s / n : null;
}

/* one product's p_thunder at the place, frame by frame: [{ t, p, nb }] */
function series(run, lat, lon) {
  const g = run.m.grid;
  const [E, N] = toBNG(lat, lon);
  const i = Math.floor((E - g.x0) / g.dx_m), j = Math.floor((N - g.y0) / g.dx_m);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return null;
  const out = [];
  for (const f of run.m.frames) {
    const p = at(field(run.m.product || (run.id.startsWith('hyper') ? 'hyper' : 'main'), run.id, f.lead_min, 'p_thunder'), g, i, j);
    if (p == null) continue;
    out.push({ t: Date.parse(f.valid), p, nb: f.neighbourhood_km ?? 10 + 0.35 * (f.lead_h ?? f.lead_min / 60) });
  }
  return out.length ? out : null;
}

const pointCache = new Map();
/** The thunderstorm risk at a place for every hour from the start of this hour to the end of
    the Main Run: { times, p (0-100), src ('hyper' | 'blend' | 'main'), nb_km, runs } or null. */
export function novaThunderAt(lat, lon) {
  const now = Date.now();
  let hyper = latest('hyper'), main = latest('main');
  if (hyper && now - hyper.init > HYPER_STALE_H * HOUR) hyper = null;
  if (main && now - main.init > MAIN_STALE_H * HOUR) main = null;
  if (!hyper && !main) return null;
  const key = `${hyper?.id}|${main?.id}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
  if (pointCache.has(key)) return pointCache.get(key);

  const H = hyper && series(hyper, lat, lon), M = main && series(main, lat, lon);
  const hyperAt = (t) => {
    if (!H) return null;
    const near = H.filter((f) => Math.abs(f.t - t) <= 30 * 60e3);
    return near.length ? near.reduce((a, b) => (b.p > a.p ? b : a)) : null;
  };
  const mainAt = (t) => {
    if (!M) return null;
    const k = M.findIndex((f) => f.t >= t);
    if (k < 0) return null;
    if (M[k].t === t || k === 0) return M[k].t - t <= 90 * 60e3 ? M[k] : null;
    const a = M[k - 1], b = M[k], w = (t - a.t) / (b.t - a.t);
    return { t, p: a.p + (b.p - a.p) * w, nb: a.nb + (b.nb - a.nb) * w };
  };
  const out = { times: [], p: [], src: [], nb_km: [] };
  const start = Math.floor(now / HOUR) * HOUR;
  const end = Math.max(M?.at(-1)?.t ?? 0, H?.at(-1)?.t ?? 0);
  for (let t = start; t <= end; t += HOUR) {
    const h = hyperAt(t), m = mainAt(t);
    const lead = hyper ? (t - hyper.init) / HOUR : Infinity;
    const wh = !h ? 0 : !m ? 1 : lead <= HYPER_ONLY_H ? 1 : lead >= MAIN_ONLY_H ? 0 : (MAIN_ONLY_H - lead) / (MAIN_ONLY_H - HYPER_ONLY_H);
    if (!h && !m) continue;
    const p = wh * (h?.p ?? 0) + (1 - wh) * (m?.p ?? 0);
    out.times.push(t);
    out.p.push(Math.round(Math.min(1, Math.max(0, p)) * 1000) / 10);
    out.src.push(wh === 1 ? 'hyper' : wh === 0 ? 'main' : 'blend');
    out.nb_km.push(Math.round(wh * (h?.nb ?? 0) + (1 - wh) * (m?.nb ?? 0)));
  }
  const res = out.times.length ? {
    ...out,
    runs: {
      hyper: hyper && H ? { run: hyper.m.init_utc, engine: hyper.m.engine_version } : null,
      main: main && M ? { run: main.m.init_utc, engine: main.m.engine_version } : null,
    },
    calibrated: [hyper?.m, main?.m].some((m) => m && !/uncal/i.test(String(m.calibration ?? 'uncalibrated'))),
  } : null;
  pointCache.set(key, res);
  while (pointCache.size > 500) pointCache.delete(pointCache.keys().next().value);
  return res;
}
