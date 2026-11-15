/* The map in plain words (15 Nov 2026, at the user's request: "a plain-English description under
   the map, which also works for screen readers"). Worked out from the frame on show over the counties
   of the UK and Ireland (public/geo/uk-ie-counties.json): where it rains and where it is heaviest,
   the mildest and coldest counties, the windiest, the cloudiest. Every number is a cell's own value
   or a county's average of them, never invented. */
import { areaStats, maskCells, typedShares } from '@/lib/areaStats';
import { projection } from '@/lib/modelGrids';
import { fmtValue } from '@/lib/modelViewer';

const cache = new Map();                                   // grid -> each county's cells on it
/** Every county's cells on a grid (worked out once a grid). */
export function countyCells(counties, grid) {
  const k = `${grid}|${counties.length}`;
  if (!cache.has(k)) {
    const P = projection(grid);
    cache.set(k, counties.map((c) => ({
      c, cells: maskCells(c.polys.flatMap((poly) => poly.map((ring) => ring.map(([lo, la]) => P.toGrid(lo, la)))), grid),
    })).filter((x) => x.cells.length));
  }
  return cache.get(k);
}

const RAIN = new Set(['radar', 'precip_rate', 'rain_rate', 'conv_rain', 'snow_rate', 'hail_rate', 'precip_1h', 'refc']);
const TEMP = /^(t2|feels|windchill|tw2|apparent|humidex|t2max\d?|t2min\d?|tskin|td2)$/;
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const uniq = (xs) => [...new Set(xs)];

/** A sentence or two about the frame over the UK and Ireland ('' where there is nothing to say). */
export function describe(frame, key, meta, cc, grid) {
  if (!frame?.q || !cc?.length) return '';
  const unit = meta?.unit || '', fv = (v) => fmtValue(v, unit);
  if (key === 'ptype' || key === 'radar_type') {
    const rows = cc.map(({ c, cells }) => ({ c, s: typedShares(frame, cells, grid) })).filter((r) => r.s);
    if (!rows.length) return '';
    const kinds = [['Rain', 0], ['Sleet', 1], ['Snow', 2], ['Freezing rain or ice', 3]].map(([name, i]) => [name, uniq(rows.filter((r) => r.s[i] >= 0.2).map((r) => r.c.group))]);
    const said = kinds.filter(([, gs]) => gs.length).map(([name, gs]) => `${name} over ${gs.length > 4 ? 'many parts' : list(gs)}`);
    return said.length ? `${said.join('; ')}.` : 'Dry almost everywhere across the UK and Ireland.';
  }
  const rows = [];
  for (const { c, cells } of cc) { const s = areaStats(frame, cells, grid, RAIN.has(key) ? 0.2 : null); if (s) rows.push({ c, s }); }
  if (!rows.length) return `${meta?.label || 'This layer'} has nothing over the UK and Ireland at this time.`;
  if (RAIN.has(key)) {
    const wet = rows.filter((r) => r.s.wetShare >= 0.25);
    if (!wet.length) return 'Dry almost everywhere across the UK and Ireland.';
    const top = rows.reduce((a, b) => (b.s.max > a.s.max ? b : a));
    const groups = uniq(wet.map((r) => r.c.group));
    const dry = uniq(rows.filter((r) => r.s.wetShare === 0).map((r) => r.c.group)).filter((g) => !groups.includes(g));
    const what = key === 'snow_rate' ? 'Snow' : 'Rain or showers';
    return `${what} over ${groups.length > 4 ? 'many parts of the UK and Ireland' : list(groups)}, heaviest in ${top.c.name} (${fv(top.s.max)}).${dry.length && dry.length <= 4 ? ` Dry in ${list(dry)}.` : ''}`;
  }
  const byMean = TEMP.test(key) || ['tcc', 'lcc', 'mcc', 'hcc', 'rh2', 'mslp'].includes(key);
  const hi = rows.reduce((a, b) => ((byMean ? b.s.mean > a.s.mean : b.s.max > a.s.max) ? b : a));
  const lo = rows.reduce((a, b) => ((byMean ? b.s.mean < a.s.mean : b.s.min < a.s.min) ? b : a));
  if (TEMP.test(key)) return `Mildest in ${hi.c.name} (around ${fv(hi.s.mean)}), coldest in ${lo.c.name} (around ${fv(lo.s.mean)}).`;
  if (key === 'tcc') return `Cloudiest over ${hi.c.name} (${fv(hi.s.mean)} cover), clearest over ${lo.c.name} (${fv(lo.s.mean)}).`;
  if (/^(gust|wind)/.test(key)) return `Windiest in ${hi.c.name} (up to ${fv(hi.s.max)}), calmest in ${lo.c.name}.`;
  if (key === 'mslp') return `Pressure highest over ${hi.c.name} (${fv(hi.s.mean)}), lowest over ${lo.c.name} (${fv(lo.s.mean)}).`;
  return `${meta?.label || 'This layer'}: highest in ${hi.c.name} (${fv(hi.s.max)}), lowest in ${lo.c.name} (${fv(lo.s.min)}).`;
}
