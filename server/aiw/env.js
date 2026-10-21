/**
 * Model-atmosphere inputs for each storm, from NOAA GFS 0.25° on AWS open data.
 *
 *   cape                Convective Available Potential Energy (surface-based), J/kg
 *   liftedIndex         surface lifted index; negative = unstable
 *   cin                 convective inhibition, J/kg (a magnitude: 0 = none)
 *   steering            700 hPa wind, a reasonable proxy for storm motion
 *   shear0_6kmKmh       vector difference between the 10 m and 500 hPa winds: organisation
 *   showersMmH          model convective precipitation rate
 *
 * gfs_env.py writes one file per valid hour (the newest GFS run covering it, regridded to a 0.5°
 * global grid) into ENV_DIR; this reads a point out of it. The live engine never waits: envPeek
 * answers from the hour already on disk (or the hour before) and starts fetching what is missing,
 * and a timer keeps this hour and the next ready. Training asks envAt for past hours, which fetches
 * them on demand (GFS runs stay on AWS), so a model trains on exactly the inputs it will see live.
 * A missing hour returns null, which the model treats as "CAPE unavailable" — never invented.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolvePython } from '../python.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ENV_DIR = process.env.AIW_ENV_DIR || (fs.existsSync('D:/') ? 'D:/MyWeatherUK-data/aiw-env' : path.join(HERE, '..', 'data', 'aiw-env'));
const KEEP_DAYS = Number(process.env.AIW_ENV_DAYS || 60);
export const ENV_SOURCE = 'NOAA GFS 0.25° (AWS open data)';

export const envHealth = { source: 'gfs', lastOkAt: null, lastError: null, hoursFetched: 0, failures: 0, cached: 0 };

const tagOf = (hour) => new Date(hour * 3600e3).toISOString().slice(0, 13).replace(/[-T]/g, '');

/* ── hour files ── */
const loaded = new Map();            // hour -> { head, grids: { name: Int16Array } }
function load(hour) {
  if (loaded.has(hour)) return loaded.get(hour);
  const tag = tagOf(hour);
  let head, buf;
  try {
    head = JSON.parse(fs.readFileSync(path.join(ENV_DIR, `${tag}.json`), 'utf8'));
    buf = fs.readFileSync(path.join(ENV_DIR, `${tag}.bin`));
  } catch { return null; }
  const n = head.nx * head.ny;
  if (buf.length !== n * 2 * head.fields.length) return null;
  const grids = {};
  head.fields.forEach((f, i) => {                                   // little-endian, as this machine is
    const a = new Int16Array(buf.buffer.slice(buf.byteOffset + i * n * 2, buf.byteOffset + (i + 1) * n * 2));
    grids[f.name] = { a, scale: f.scale };
  });
  const entry = { head, grids };
  loaded.set(hour, entry);
  while (loaded.size > 6) loaded.delete(loaded.keys().next().value);
  return entry;
}

/* ── fetching (one Python run for any number of hours) ── */
const pending = new Map();           // hour -> Promise
function fetchHours(hours) {
  const want = [...new Set(hours)].filter((h) => !pending.has(h) && !fs.existsSync(path.join(ENV_DIR, `${tagOf(h)}.bin`)));
  if (!want.length) return Promise.all(hours.map((h) => pending.get(h)).filter(Boolean));
  const py = resolvePython();
  const run = new Promise((resolve) => {
    let p;
    try {
      p = spawn(py.cmd, [path.join(HERE, 'gfs_env.py'), ENV_DIR, ...want.map(tagOf)], { windowsHide: true, env: { ...process.env, ...py.env } });
    } catch (e) { envHealth.lastError = e.message; envHealth.failures += 1; resolve(); return; }
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', () => {});
    const kill = setTimeout(() => p.kill(), 15 * 60e3);
    const done = () => {
      clearTimeout(kill);
      for (const line of out.split(/\r?\n/)) {
        if (!line.startsWith('{')) continue;
        try {
          const j = JSON.parse(line);
          if (j.ok) { envHealth.hoursFetched += 1; envHealth.lastOkAt = Date.now(); } else { envHealth.failures += 1; envHealth.lastError = j.error; }
        } catch { /* a torn line */ }
      }
      for (const h of want) pending.delete(h);
      resolve();
    };
    p.on('error', (e) => { envHealth.lastError = `could not start Python (${e.message})`; envHealth.failures += 1; done(); });
    p.on('close', done);
  });
  for (const h of want) pending.set(h, run);
  return run;
}

/** Make sure these valid hours (epoch hours) are on disk; training calls this first for every
 *  hour that has lightning in it. */
export async function prefetchHours(hours, batch = 24) {
  const list = [...new Set(hours)].sort((a, b) => a - b);
  for (let i = 0; i < list.length; i += batch) await fetchHours(list.slice(i, i + batch));
}

/* ── a point ── */
function sample(entry, lat, lon) {
  const { head, grids } = entry;
  const fy = (head.lat0 - lat) / -head.dlat;                       // rows run north to south
  const fx = ((((lon - head.lon0) % 360) + 360) % 360) / head.dlon;
  const j = Math.min(head.ny - 2, Math.max(0, Math.floor(fy))), i = Math.floor(fx) % head.nx;
  const i2 = (i + 1) % head.nx, u = fx - Math.floor(fx), v = Math.min(1, Math.max(0, fy - j));
  const at = (name) => {
    const g = grids[name]; if (!g) return null;
    const a = g.a, nx = head.nx;
    const val = (a[j * nx + i] * (1 - u) + a[j * nx + i2] * u) * (1 - v) + (a[(j + 1) * nx + i] * (1 - u) + a[(j + 1) * nx + i2] * u) * v;
    return val / g.scale;
  };
  const u10 = at('u10'), v10 = at('v10'), u500 = at('u500'), v500 = at('v500'), u700 = at('u700'), v700 = at('v700');
  const cape = at('cape'), lftx = at('lftx'), cin = at('cin'), cprat = at('cprat');
  const kmh = (x) => x * 3.6;
  const steering = u700 != null && v700 != null ? {
    vx: kmh(u700) / 60, vy: kmh(v700) / 60,                       // km per minute, towards
    speedKmh: Math.round(kmh(Math.hypot(u700, v700))),
    fromDeg: Math.round(((Math.atan2(-u700, -v700) * 180) / Math.PI + 360) % 360),
    source: 'steering-700hPa',
  } : null;
  return {
    source: 'gfs', model: `GFS ${head.cycle.slice(11, 13)}Z +${head.fh} h`, validHour: head.valid.replace('+00:00', 'Z'),
    tile: `${(Math.round(lat * 2) / 2).toFixed(1)},${(Math.round(lon * 2) / 2).toFixed(1)}`,
    cape: cape == null ? null : Math.round(Math.max(0, cape)), liftedIndex: lftx == null ? null : +lftx.toFixed(1),
    cin: cin == null ? null : Math.round(Math.abs(cin)), showersMmH: cprat == null ? null : +Math.max(0, cprat).toFixed(2),
    steering,
    shear0_6kmKmh: u10 != null && u500 != null ? Math.round(kmh(Math.hypot(u500 - u10, v500 - v10))) : null,
  };
}

/** The atmosphere at a point for the hour containing `now`, fetching that hour if it is not on
 *  disk yet (training, and anything else that can wait). */
export async function envAt(lat, lon, now = Date.now()) {
  const hour = Math.floor(now / 3600e3);
  let e = load(hour);
  if (!e) { await fetchHours([hour]); e = load(hour); }
  if (!e) return null;
  envHealth.cached += 1;
  return sample(e, lat, lon);
}

/** The live engine's lookup: never waits. This hour if it is on disk, else the hour before while
 *  this one is fetched in the background. */
export function envPeek(lat, lon, now = Date.now()) {
  const hour = Math.floor(now / 3600e3);
  const e = load(hour);
  if (e) { envHealth.cached += 1; return sample(e, lat, lon); }
  fetchHours([hour, hour + 1]);
  const prev = load(hour - 1);
  return prev ? sample(prev, lat, lon) : null;
}

/** Keep this hour and the next on disk, and drop hour-files older than KEEP_DAYS. */
export function startEnvUpkeep() {
  const tick = () => {
    const hour = Math.floor(Date.now() / 3600e3);
    fetchHours([hour, hour + 1]);
    const cutoff = tagOf(hour - KEEP_DAYS * 24);
    try {
      for (const f of fs.readdirSync(ENV_DIR)) if (/^\d{10}\.(bin|json)$/.test(f) && f.slice(0, 10) < cutoff) fs.rmSync(path.join(ENV_DIR, f), { force: true });
    } catch { /* nothing yet */ }
  };
  fs.mkdirSync(ENV_DIR, { recursive: true });
  tick();
  const t = setInterval(tick, 10 * 60e3);
  t.unref?.();
}
