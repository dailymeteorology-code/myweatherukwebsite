/**
 * Build the live week-ahead scenarios and write them to a JSON file.
 *
 *   node server/scenarios/live/run.mjs [--out path]
 *
 * Used by the GitHub Actions workflow (.github/workflows/live-scenarios.yml),
 * which runs it at 06:00 UK time every day on GitHub's servers — so it works
 * whether or not the self-hosted PC is switched on — and by the site's own
 * scheduler as a fallback.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchModels, buildScenarios } from './ensemble.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argOut = process.argv.indexOf('--out');
const OUT = argOut > 0 ? path.resolve(process.argv[argOut + 1]) : path.resolve(here, '../../data/scenarios-local/live-scenarios.json');

export async function runLive({ out = OUT, log = console.log } = {}) {
  const climate = JSON.parse(fs.readFileSync(path.resolve(here, '../../data/scenarios/climate-1991-2020.json'), 'utf8'));
  const started = Date.now();
  const locs = await fetchModels({ log });
  const result = buildScenarios(locs, { climate, issued: new Date() });
  result.buildSeconds = Math.round((Date.now() - started) / 1000);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(result));
  try { fs.renameSync(tmp, out); } catch { fs.writeFileSync(out, JSON.stringify(result)); }
  log(`Wrote ${out}: ${result.scenarios.map((s) => `${s.rank} ${s.probability}%`).join(', ')} (${result.buildSeconds}s)`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLive().catch((e) => { console.error(e); process.exit(1); });
}
