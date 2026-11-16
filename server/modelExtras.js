/* Model Data: the point and column tools (16 Nov 2026, at the user's request: "every model at a pin",
   "Skew-T at a pin", "cross-section", "back-trajectories").

   GET /api/modeldata/point?v=t2&lat=&lon=[&models=ukv,gfs,...]   every model's newest run at a place,
       read from the frames already made (the layer's frames are not made here; a model whose layer
       is not made yet is listed as such)
   GET /api/modeldata/sounding?run=&step=&lat=&lon=                 GFS profile, its parcels and indices
   GET /api/modeldata/section?run=&step=&lat1=&lon1=&lat2=&lon2=    GFS cross-section along a line
   GET /api/modeldata/trajectory?run=&step=&lat=&lon=[&hours=72]    where the air came from (GFS)
   The last three run tools/modeldata/mdata/sounding.py (NOAA NOMADS, cached on D:), two at a time. */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { resolveEnsPython } from './pastFuture/index.js';
import { GRIDS, projection } from '../src/lib/modelGrids.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.resolve(HERE, '..', 'tools', 'modeldata');
const gunzip = promisify(zlib.gunzip);

/* ── Python tools, two at a time, each answer kept a while ──────────────────────────────────────── */
const queue = [];
let running = 0;
const cache = new Map();                           // key -> { at, body }
const CACHE_MS = 30 * 60e3;
function runTool(args, module = 'mdata.sounding', env = {}) {
  return new Promise((resolve, reject) => {
    queue.push({ args, module, env, resolve, reject });
    pump();
  });
}
function pump() {
  while (running < 2 && queue.length) {
    const { args, module, env, resolve, reject } = queue.shift();
    running += 1;
    const py = resolveEnsPython();
    const child = spawn(py.cmd, ['-m', module, ...args], { cwd: TOOL, env: { ...process.env, ...py.env, PYTHONIOENCODING: 'utf-8', ...env }, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), 240e3);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err = (err + d).slice(-1500); });
    child.on('error', (e) => { clearTimeout(timer); running -= 1; reject(e); pump(); });
    child.on('exit', () => {
      clearTimeout(timer);
      running -= 1;
      try {
        const j = JSON.parse(out.trim().split('\n').pop() || '{}');
        if (j.error) reject(new Error(j.error)); else resolve(j);
      } catch { reject(new Error(err.slice(-300) || 'no answer')); }
      pump();
    });
  }
}
const hits = new Map();
function limited(req) {
  const ip = String(req.get('cf-connecting-ip') || req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();
  const now = Date.now();
  const a = (hits.get(ip) || []).filter((t) => now - t < 60e3);
  a.push(now);
  hits.set(ip, a);
  if (hits.size > 5000) hits.clear();
  return a.length > 30;
}
const num = (x, lo, hi) => { const v = Number(x); return Number.isFinite(v) && v >= lo && v <= hi ? v : null; };

export function mountModelExtras(app, { DATA }) {
  const catalog = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'catalog.json'), 'utf8')); } catch { return null; } };
  /* a GFS run the catalogue lists, and a step it has */
  const gfsRun = (run, step) => {
    const g = catalog()?.models?.find((m) => m.id === 'gfs');
    const r = g?.runs?.find((x) => Date.parse(x.run) === Date.parse(run));
    return r && r.steps.includes(step) ? r : null;
  };
  const tool = (name, argsOf, module, env) => async (req, res) => {
    if (limited(req)) return res.status(429).json({ error: 'Too many asked for just now: try again in a minute.' });
    const args = argsOf(req.query);
    if (!args) return res.status(400).json({ error: 'That place, line or time is not one the page can ask for.' });
    const key = `${name}|${args.join('|')}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.body);
    try {
      const body = await runTool(module ? args : [name, ...args], module, env);
      cache.set(key, { at: Date.now(), body });
      if (cache.size > 300) cache.delete(cache.keys().next().value);
      res.set('Cache-Control', 'public, max-age=600');
      res.json(body);
    } catch (e) {
      res.status(502).json({ error: `NOAA's servers did not answer in time (${String(e.message || e).slice(0, 160)}).` });
    }
  };
  const runStep = (q) => {
    const step = num(q.step, 0, 384);
    return step == null || !gfsRun(q.run, step) ? null : [new Date(q.run).toISOString(), String(step)];
  };
  app.get('/api/modeldata/sounding', tool('profile', (q) => {
    const rs = runStep(q), lat = num(q.lat, -89, 89), lon = num(q.lon, -180, 180);
    return rs && lat != null && lon != null ? [...rs, lat.toFixed(2), lon.toFixed(2)] : null;
  }));
  app.get('/api/modeldata/section', tool('section', (q) => {
    const rs = runStep(q), p = [num(q.lat1, -89, 89), num(q.lon1, -180, 180), num(q.lat2, -89, 89), num(q.lon2, -180, 180)];
    if (!rs || p.some((x) => x == null)) return null;
    const km = Math.hypot((p[2] - p[0]) * 111, (p[3] - p[1]) * 111 * Math.cos((p[0] * Math.PI) / 180));
    return km < 20 || km > 4000 ? null : [...rs, ...p.map((x) => x.toFixed(2))];
  }));
  app.get('/api/modeldata/trajectory', tool('trajectory', (q) => {
    const rs = runStep(q), lat = num(q.lat, 20, 82), lon = num(q.lon, -90, 50), hours = num(q.hours ?? 72, 12, 120);
    return rs && lat != null && lon != null && hours != null ? [...rs, lat.toFixed(2), lon.toFixed(2), String(Math.round(hours / 3) * 3)] : null;
  }));

  /* the ways an ensemble's members split at a time ahead (mdata/scenarios.py) */
  app.get('/api/modeldata/scenarios', tool('scenarios', (q) => {
    const ens = catalog()?.ensembles?.find((m) => m.id === q.ens);
    const r = ens?.runs?.find((x) => Date.parse(x.run) === Date.parse(q.run));
    const step = num(q.step, 0, 840);
    return r && step != null && r.steps.includes(step) && (ens.fields || []).includes('mslp') ? [ens.id, new Date(q.run).toISOString(), String(step)] : null;
  }, 'mdata.scenarios', { MDATA_GRID: 'eu' }));

  /* ── a road by its number (16 Nov 2026, "route forecast along roads"): the M6, the A9... from
     OpenStreetMap (Overpass API), its pieces joined into one line from its south or west end,
     every kilometre, kept on D: for 90 days ── */
  const ROADS = path.join(DATA, 'roads');
  const roadBusy = new Map();
  async function road(ref) {
    const base = ref.replace(/[^A-Za-z0-9]/g, '_');
    const f = path.join(ROADS, `${base}.v2.json`), raw = path.join(ROADS, `${base}.osm.json`);
    try { const st = fs.statSync(f); if (Date.now() - st.mtimeMs < 90 * 86400e3) return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* not kept yet */ }
    const esc = ref.replace(/[()]/g, (c) => `\\\\${c}`);           // A1(M): the brackets escaped in Overpass's regex
    const q = `[out:json][timeout:90];area["ISO3166-1"~"^(GB|IE)$"][admin_level=2]->.a;way["highway"~"^(motorway|trunk|primary)$"]["ref"~"(^|;)${esc}(;|$)"](area.a);out geom;`;
    /* OpenStreetMap's main road server, then its mirrors, each tried in turn (they turn work away when busy) */
    let json = null, last = null;
    try { if (Date.now() - fs.statSync(raw).mtimeMs < 90 * 86400e3) json = JSON.parse(fs.readFileSync(raw, 'utf8')); } catch { /* not fetched yet */ }
    for (const host of json ? [] : ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
      try {
        const r = await fetch(host, { method: 'POST', body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(150e3),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'MyWeatherUK-modeldata/1.0' } });
        if (!r.ok) throw new Error(`said ${r.status}`);
        json = await r.json();
        break;
      } catch (e) { last = e; }
    }
    if (!json) throw new Error(`OpenStreetMap's road servers are busy (${last?.message || 'no answer'})`);
    fs.mkdirSync(ROADS, { recursive: true });
    fs.writeFileSync(raw, JSON.stringify(json));
    /* roundabouts left out: round one, a line can come back down the other carriageway (the join bridges the gap) */
    const ways = (json.elements || []).filter((w) => w.type === 'way' && w.geometry?.length > 1 && !['roundabout', 'circular'].includes(w.tags?.junction))
      .map((w) => ({ pts: w.geometry.map((g) => [g.lon, g.lat]), oneway: w.tags?.highway === 'motorway' || ['yes', '1', 'true'].includes(w.tags?.oneway) }));
    if (!ways.length) return null;
    const km = (a, b) => { const r0 = Math.PI / 180, x = (b[0] - a[0]) * r0 * Math.cos(((a[1] + b[1]) / 2) * r0), y = (b[1] - a[1]) * r0; return 6371 * Math.hypot(x, y); };
    const lenOf = (line) => line.reduce((s0, pt, i) => (i ? s0 + km(line[i - 1], pt) : 0), 0);
    /* the pieces joined end to end into chains: a one-way piece (a motorway carriageway) only the way
       it runs, so a chain never turns back down the other carriageway */
    const key = (pt) => `${pt[0].toFixed(5)},${pt[1].toFixed(5)}`;
    const starts = new Map(), endsAt = new Map();
    const add = (m, k, i) => { if (!m.has(k)) m.set(k, []); m.get(k).push(i); };
    ways.forEach((w, i) => { add(starts, key(w.pts[0]), i); add(endsAt, key(w.pts[w.pts.length - 1]), i); });
    const used = new Set();
    /* at each joint the piece that carries straight on, never one turning back (where a dual
       carriageway meets a single one, the other carriageway turns back) */
    const heading = (a, b) => Math.atan2(b[1] - a[1], (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180));
    const turn = (h1, h2) => { const d = Math.abs(h1 - h2) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
    const pick = (cands, h0) => {
      let best = null;
      for (const c of cands) {
        const s = h0 == null ? 0 : turn(h0, heading(c.pts[0], c.pts[Math.min(3, c.pts.length - 1)]));
        if (s <= 2.1 && (!best || s < best.s)) best = { ...c, s };
      }
      return best;
    };
    const forward = (line) => {
      for (;;) {
        const n = line.length, k = key(line[n - 1]);
        const h0 = n > 1 ? heading(line[Math.max(0, n - 4)], line[n - 1]) : null;
        const cands = [...(starts.get(k) || []).filter((j) => !used.has(j)).map((j) => ({ j, pts: ways[j].pts })),
          ...(endsAt.get(k) || []).filter((j) => !used.has(j) && !ways[j].oneway).map((j) => ({ j, pts: [...ways[j].pts].reverse() }))];
        const c = pick(cands, h0);
        if (!c) return line;
        used.add(c.j);
        line = line.concat(c.pts.slice(1));
      }
    };
    const backward = (line) => {
      for (;;) {
        const k = key(line[0]);
        const h0 = line.length > 1 ? heading(line[Math.min(3, line.length - 1)], line[0]) : null;   // going back along the line
        const cands = [...(endsAt.get(k) || []).filter((j) => !used.has(j)).map((j) => ({ j, pts: [...ways[j].pts].reverse() })),
          ...(starts.get(k) || []).filter((j) => !used.has(j) && !ways[j].oneway).map((j) => ({ j, pts: ways[j].pts }))];
        const c = pick(cands, h0);
        if (!c) return line;
        used.add(c.j);
        line = [...c.pts].reverse().slice(0, -1).concat(line);
      }
    };
    const chains = [];
    ways.forEach((w, i) => { if (!used.has(i)) { used.add(i); chains.push(backward(forward([...w.pts]))); } });
    /* a chain that still ends where it began went up one carriageway and back: cut at its far point, the longer half kept */
    for (let i = 0; i < chains.length; i++) {
      const c = chains[i];
      if (c.length > 4 && km(c[0], c[c.length - 1]) < 1.5 && lenOf(c) > 5) {
        let far = 0;
        c.forEach((pt, j) => { if (km(c[0], pt) > km(c[0], c[far])) far = j; });
        const a0 = c.slice(0, far + 1), b0 = c.slice(far);
        chains[i] = lenOf(a0) >= lenOf(b0) ? a0 : b0;
      }
    }
    chains.sort((a, b) => lenOf(b) - lenOf(a));
    /* a chain alongside one already kept is the other carriageway: left out */
    const kept = [];
    const near = (pt, line) => line.some((q, i) => i % 2 === 0 && km(pt, q) < 0.3);
    for (const c of chains) {
      if (lenOf(c) < 1) continue;
      const sample = c.filter((_, i) => i % Math.max(1, Math.floor(c.length / 25)) === 0);
      if (kept.some((k) => sample.filter((pt) => near(pt, k)).length >= 0.6 * sample.length)) continue;
      kept.push(c);
    }
    /* then joined across short gaps (a roundabout, a stretch shared with another number), only where
       the road carries on away from where it began */
    let route = kept.shift();
    for (let joined = true; joined && kept.length;) {
      joined = false;
      let best = null;
      kept.forEach((c, i) => {
        const h = route[0], t = route[route.length - 1];
        /* [the gap, the joined line, the piece's far end, the route's end it joins, the route's other end] */
        for (const [gap, make, far, end, from] of [
          [km(t, c[0]), () => route.concat(c), c[c.length - 1], t, h], [km(t, c[c.length - 1]), () => route.concat([...c].reverse()), c[0], t, h],
          [km(h, c[c.length - 1]), () => c.concat(route), c[0], h, t], [km(h, c[0]), () => [...c].reverse().concat(route), c[c.length - 1], h, t]]) {
          if (gap < 25 && km(far, from) > km(end, from) && (!best || gap < best.gap)) best = { gap, make, i };
        }
      });
      if (best) { route = best.make(); kept.splice(best.i, 1); joined = true; }
    }
    if ((route[0][1] - route[route.length - 1][1]) + (route[0][0] - route[route.length - 1][0]) * 0.6 > 0) route.reverse();   // from the south or west end
    /* every kilometre along it */
    const pts = [route[0]], at = [0];
    let total = 0, carry = 0;
    for (let i = 1; i < route.length; i++) {
      const d = km(route[i - 1], route[i]);
      let used0 = 0;
      while (carry + (d - used0) >= 1) {
        const f = (used0 + (1 - carry)) / d;
        pts.push([route[i - 1][0] + f * (route[i][0] - route[i - 1][0]), route[i - 1][1] + f * (route[i][1] - route[i - 1][1])]);
        used0 += 1 - carry; carry = 0; total += 1; at.push(total);
      }
      carry += d - used0;
    }
    const out = { ref, km: Math.round(total + carry), points: pts.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]), source: 'OpenStreetMap contributors (ODbL)' };
    fs.mkdirSync(ROADS, { recursive: true });
    fs.writeFileSync(f, JSON.stringify(out));
    return out;
  }
  /* the main roads fetched once in the background, one at a time with a pause between (OpenStreetMap's
     road servers are shared), so a route is usually ready the moment it is asked for */
  const MAIN_ROADS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M8', 'M9', 'M11', 'M18', 'M20', 'M23', 'M25', 'M27', 'M40', 'M42', 'M48', 'M50', 'M53', 'M54',
    'M55', 'M56', 'M58', 'M60', 'M61', 'M62', 'M65', 'M66', 'M69', 'M74', 'M77', 'M80', 'M90', 'M180', 'A1', 'A1(M)', 'A2', 'A3', 'A5', 'A6', 'A9', 'A11',
    'A12', 'A14', 'A30', 'A303', 'A34', 'A35', 'A38', 'A39', 'A47', 'A55', 'A66', 'A69', 'A74(M)', 'A75', 'A76', 'A77', 'A82', 'A83', 'A85', 'A86', 'A87',
    'A90', 'A92', 'A93', 'A95', 'A96', 'A99', 'A470', 'A483', 'A487', 'A835'];
  const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });
  (async () => {
    await sleep(3 * 60e3);
    let fails = 0;
    for (const ref of MAIN_ROADS) {
      const kept = path.join(ROADS, `${ref.replace(/[^A-Za-z0-9]/g, '_')}.v2.json`);
      try { if (Date.now() - fs.statSync(kept).mtimeMs < 80 * 86400e3) continue; } catch { /* not kept yet */ }
      try { await road(ref); fails = 0; } catch { fails += 1; }
      await sleep(fails >= 3 ? 30 * 60e3 : 20e3);
      if (fails >= 3) fails = 0;
    }
  })();

  app.get('/api/modeldata/road', async (req, res) => {
    const ref = String(req.query.ref || '').toUpperCase().replace(/\s+/g, '');
    if (!/^[AMN]\d{1,4}(\(M\))?$/.test(ref)) return res.status(400).json({ error: 'A road number is a letter and its number: M6, A9, A1(M), N7.' });
    if (limited(req)) return res.status(429).json({ error: 'Too many asked for just now: try again in a minute.' });
    try {
      if (!roadBusy.has(ref)) roadBusy.set(ref, road(ref).finally(() => setTimeout(() => roadBusy.delete(ref), 1000)));
      const body = await roadBusy.get(ref);
      if (!body) return res.status(404).json({ error: `No road numbered ${ref} in the UK or Ireland.` });
      res.set('Cache-Control', 'public, max-age=86400');
      res.json(body);
    } catch (e) {
      res.status(502).json({ error: `The road could not be fetched (${String(e.message || e).slice(0, 120)}).` });
    }
  });

  /* ── every model's newest run at a place ─────────────────────────────────────────────────────── */
  const values = new Map();                        // frame file -> its value at a cell
  const framesRoot = (grid) => path.join(DATA, grid === 'uk' ? 'frames' : `frames_${grid}`);
  async function at(file, j, i) {
    const key = `${file}|${j}|${i}`;
    if (values.has(key)) return values.get(key);
    const raw = await gunzip(await fs.promises.readFile(file));
    const n = raw.readUInt32LE(0);
    const h = JSON.parse(raw.subarray(4, 4 + n).toString('utf8'));
    let v = null;
    if (j >= 0 && i >= 0 && j < h.ny && i < h.nx) {
      const q = raw[4 + n + j * h.nx + i];
      if (q !== 255) {
        if (h.scale === 'sqrt') { const a = Math.sqrt(Math.max(h.lo, 0)), b = Math.sqrt(h.hi); v = (a + (q / 254) * (b - a)) ** 2; } else v = h.lo + (q / 254) * (h.hi - h.lo);
      }
    }
    values.set(key, v);
    if (values.size > 200000) values.clear();
    return v;
  }
  const SKIP = new Set(['frost', 'mix', 'consensus', 'gefs_aer', 'ecmwf_ensm', 'aifs_ensm']);
  app.get('/api/modeldata/point', async (req, res) => {
    const v = String(req.query.v || '');
    const lat = num(req.query.lat, -89, 89), lon = num(req.query.lon, -180, 180);
    const cat = catalog();
    if (!cat || !/^[a-z0-9_]{1,40}$/.test(v) || lat == null || lon == null) return res.status(400).json({ error: 'That place or layer is not one the page can ask for.' });
    const want = req.query.models ? new Set(String(req.query.models).split(',')) : null;
    const out = [];
    for (const m of cat.models || []) {
      if (!m.runs?.length || !(m.variables || []).includes(v) || (want ? !want.has(m.id) : SKIP.has(m.id))) continue;
      const grid = m.grid || 'eu';
      if (!GRIDS[grid]) continue;
      const [x, y] = projection(grid).toGrid(lon, lat);
      const j = Math.round(y), i = Math.round(x);
      if (j < 0 || i < 0 || j >= GRIDS[grid].ny || i >= GRIDS[grid].nx) continue;
      const r = m.runs.find((rr) => !rr.kept && rr.complete) || m.runs[0];
      const tag = `${r.run.slice(0, 4)}${r.run.slice(5, 7)}${r.run.slice(8, 10)}T${r.run.slice(11, 13)}${r.run.slice(14, 16)}Z`;
      const dir = path.join(framesRoot(grid), m.id, tag, v);
      let done = [];
      try { done = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8')).done || []; } catch { /* not made yet */ }
      const t0 = Date.parse(r.run);
      const series = (await Promise.all([...done].sort((a, b) => a - b).map(async (s) => {
        try { return [t0 + s * 3600e3, await at(path.join(dir, `${s}.bin`), j, i)]; } catch { return null; }
      }))).filter((p) => p && p[1] != null);
      out.push({ id: m.id, label: m.label, run: r.run, made: done.length > 0, values: series.map(([t, val]) => [t, Math.round(val * 100) / 100]) });
    }
    res.set('Cache-Control', 'no-cache');
    res.json({ v, lat, lon, unit: cat.variables?.[v]?.unit || '', label: cat.variables?.[v]?.label || v, models: out });
  });
}
