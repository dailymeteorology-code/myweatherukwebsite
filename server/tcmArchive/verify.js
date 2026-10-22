/* TCM Verification: how a day's lightning risk forecast did against the lightning that came.
   For a London day:

   - Forecast: the Main Run's whole-day lightning probability, the day's frames combined (their
     peak), from the run made the evening before; the first run of the day where there is none.
   - Observed: every strike the Met Office recorded over the UK & Ireland that day.

   It gives, for each risk level (the TCM levels, TSTM 2% up to HIGH 60%), how much of the map it
   covered, how many of the day's strikes fell inside it, and how much of it saw lightning within
   10 km. Strikes inside is how much of the lightning the outlook caught; area that saw lightning is
   how much of the outlook was needed. A day's strikes settle three hours after it ends; from then
   its result is written to disk and kept. */
import fs from 'node:fs';
import path from 'node:path';
import { decodeField, cellOf } from './grid.js';

export const LEVELS = [
  { key: 'TSTM', label: 'General thunder', p: 0.02 },
  { key: 'MRGL', label: 'Marginal', p: 0.05 },
  { key: 'SLGT', label: 'Slight', p: 0.15 },
  { key: 'ENH', label: 'Enhanced', p: 0.3 },
  { key: 'MDT', label: 'Moderate', p: 0.45 },
  { key: 'HIGH', label: 'High', p: 0.6 },
];
const NEAR_KM = 10;
const SETTLE_MS = 3 * 3600e3;
const LIVE_MS = 10 * 60e3;                       // how long an unsettled day's result is reused
const VERSION = 2;

const levelOf = (p) => { let k = null; for (const L of LEVELS) if (p >= L.p) k = L.key; return k; };

/* cells within r cells of a set cell (a square), in two running-sum passes */
function dilate(mask, nx, ny, r) {
  const rows = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  for (let j = 0; j < ny; j += 1) {
    let n = 0;
    const o = j * nx;
    for (let i = 0; i < Math.min(r, nx); i += 1) n += mask[o + i];
    for (let i = 0; i < nx; i += 1) {
      if (i + r < nx) n += mask[o + i + r];
      if (i - r - 1 >= 0) n -= mask[o + i - r - 1];
      rows[o + i] = n > 0 ? 1 : 0;
    }
  }
  for (let i = 0; i < nx; i += 1) {
    let n = 0;
    for (let j = 0; j < Math.min(r, ny); j += 1) n += rows[j * nx + i];
    for (let j = 0; j < ny; j += 1) {
      if (j + r < ny) n += rows[(j + r) * nx + i];
      if (j - r - 1 >= 0) n -= rows[(j - r - 1) * nx + i];
      out[j * nx + i] = n > 0 ? 1 : 0;
    }
  }
  return out;
}

export function createVerifier({ root, lightning, dayAheadRun, archivedRuns, archivedManifest, londonDayBounds }) {
  const dir = path.join(root, 'verify');
  fs.mkdirSync(dir, { recursive: true });
  const memo = new Map();
  const fileOf = (date, runId) => path.join(dir, `${date}__${runId}.json`);
  const hasStrikeData = (date) => {
    try { return lightning ? lightning.availableDays(400).includes(date) : false; } catch { return false; }
  };

  function compute(date, runId) {
    const m = archivedManifest('main', runId);
    const d = m?.days?.find((x) => x.date === date);
    if (!d || !(d.fields || []).includes('p_lightning')) return null;
    let field;
    try { field = decodeField(fs.readFileSync(path.join(root, 'main', runId, 'days', date, 'p_lightning.bin'))); } catch { return null; }
    const g = m.grid;
    const [t0, t1] = londonDayBounds(date);
    const strikes = lightning ? lightning.collect(t0, t1, 'uk', 'mo', 5e6) : { strikes: [], total: 0 };
    const flat = strikes.strikes;
    const N = g.nx * g.ny;
    const hit = new Uint8Array(N);
    const inside = new Array(LEVELS.length).fill(0);
    let onGrid = 0;
    for (let k = 0; k < flat.length; k += 4) {
      const c = cellOf(g, flat[k + 1], flat[k + 2]);
      if (c < 0) continue;
      onGrid += 1;
      hit[c] = 1;
      const v = field[c];
      for (let q = 0; q < LEVELS.length && v >= LEVELS[q].p; q += 1) inside[q] += 1;
    }
    const near = dilate(hit, g.nx, g.ny, Math.max(1, Math.round(NEAR_KM * 1000 / g.dx_m)));
    const area = new Array(LEVELS.length).fill(0), lit = new Array(LEVELS.length).fill(0);
    for (let c = 0; c < N; c += 1) {
      const v = field[c];
      if (!(v >= LEVELS[0].p)) continue;
      for (let q = 0; q < LEVELS.length && v >= LEVELS[q].p; q += 1) { area[q] += 1; if (near[c]) lit[q] += 1; }
    }
    const cellKm2 = g.cell_area_km2 || (g.dx_m / 1000) ** 2;
    const peak = d.stats?.p_lightning?.max ?? 0;
    return {
      v: VERSION, date, final: Date.now() > t1 + SETTLE_MS, computed_utc: new Date().toISOString(),
      run: { run_id: runId, init_utc: m.init_utc, init_local: m.init_local, lead_h: Math.round((t0 - Date.parse(m.init_utc)) / 3600e3), engine_version: m.engine_version, grid: g },
      strikes: { total: strikes.total, on_grid: onGrid, data: hasStrikeData(date), source: 'Met Office (LEELA)' },
      peak: { p: peak, level: levelOf(peak) },
      near_km: NEAR_KM,
      levels: LEVELS.map((L, q) => ({
        ...L, area_km2: Math.round(area[q] * cellKm2), strikes: inside[q],
        strikes_frac: onGrid ? inside[q] / onGrid : null, lit_frac: area[q] ? lit[q] / area[q] : null,
      })),
    };
  }

  /** The result for `date` from run `runId`, from memory or disk, or worked out now. */
  function get(date, runId, { computeIfMissing = true } = {}) {
    const key = `${date}|${runId}`;
    const hit = memo.get(key);
    if (hit && (hit.final || Date.now() - Date.parse(hit.computed_utc) < LIVE_MS)) return hit;
    const disk = (() => { try { return JSON.parse(fs.readFileSync(fileOf(date, runId), 'utf8')); } catch { return null; } })();
    if (disk?.v === VERSION && disk.final) { memo.set(key, disk); return disk; }
    if (!computeIfMissing) return null;
    const r = compute(date, runId);
    if (!r) return null;
    memo.set(key, r);
    if (r.final) fs.writeFileSync(fileOf(date, runId), JSON.stringify(r));
    return r;
  }

  /* every day that has finished and has a Main Run forecast in the archive, newest first */
  function finishedDays() {
    const now = Date.now();
    const days = new Set();
    for (const r of archivedRuns('main', { all: true })) for (const d of r.days) if (d.has_lightning) days.add(d.date);
    return [...days].filter((d) => londonDayBounds(d)[1] <= now).sort().reverse();
  }

  return {
    /** Every finished day: worked out ones in full, the rest marked pending (warm() fills them in). */
    list() {
      let budget = 2;
      return finishedDays().map((date) => {
        const da = dayAheadRun(date);
        if (!da) return null;
        let r = get(date, da.run.run_id, { computeIfMissing: false });
        if (!r && budget > 0) { budget -= 1; r = get(date, da.run.run_id); }
        return r ? { ...r, same_day: da.same_day } : { date, pending: true };
      }).filter(Boolean);
    },
    /** One day in full, from `runId` or the day-ahead run, with the runs that could be used instead. */
    day(date, runId = null) {
      const covering = archivedRuns('main', { all: true }).filter((r) => r.days.some((d) => d.date === date && d.has_lightning));
      if (!covering.length) return null;
      const da = dayAheadRun(date);
      const use = (runId && covering.find((r) => r.run_id === runId)) || da?.run;
      if (!use) return null;
      const r = get(date, use.run_id);
      if (!r) return null;
      const [t0] = londonDayBounds(date);
      return {
        ...r, same_day: Date.parse(use.init_utc) > t0, default_run: da?.run.run_id || null,
        choices: covering.map((c) => ({ run_id: c.run_id, init_utc: c.init_utc, init_local: c.init_local, complete: c.days.find((d) => d.date === date).complete })),
      };
    },
    /** Work out every finished day not yet on disk, one at a time so the site stays responsive. */
    async warm() {
      for (const date of finishedDays()) {
        const da = dayAheadRun(date);
        if (!da || get(date, da.run.run_id, { computeIfMissing: false })) continue;
        get(date, da.run.run_id);
        await new Promise((r) => setImmediate(r));
      }
    },
  };
}
