// TCM V3 run builder (GitHub Actions; see .github/workflows/tcm-v3.yml).
//
//   node tools/tcm-v3/build.mjs coords  out/coords.json
//   node tools/tcm-v3/build.mjs score   out/points.json.gz out/
//
// `coords` writes V3's own 0.5° UK & Ireland node list (same buildCoords as the page).
// `score` runs V3's own engine (buildTCMFromPoints in src/lib/openMeteoTCM.js) on the AWS
// point series made by tools/tcm-nova/nova/v3_points.py, then V3's own saveTCMRunToDB
// against an in-memory stand-in for the database, so the published DB rows are byte-for-
// byte what the page itself would have written. Outputs:
//   payload.json.gz   full payload (what /api/tcm-v3/latest serves)
//   db-rows.json.gz   RiskGridCache rows (run key, latest key, archive key) for the site DB
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..', '..', 'src');
const UK = { lonMin: -11.0, lonMax: 2.5, latMin: 49.5, latMax: 61.5 };   // REGIONS.uk.bbox in WeatherPatterns.jsx

async function loadEngine() {
  const out = path.join(here, '.bundle.mjs');
  await esbuild.build({
    stdin: {
      contents: `export * from '@/lib/openMeteoTCM'; export { saveTCMRunToDB } from '@/lib/tcmForecastCache';`,
      resolveDir: src, loader: 'js',
    },
    bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    plugins: [{
      name: 'alias',
      setup(b) {
        b.onResolve({ filter: /^@\/api\/base44Client$/ }, () => ({ path: './base44-stub.mjs', external: true }));   // shared with this script (same instance)
        b.onResolve({ filter: /^@\// }, (a) => {
          const p = path.join(src, a.path.slice(2));
          for (const ext of ['', '.js', '.jsx', '/index.js']) if (fs.existsSync(p + ext) && fs.statSync(p + ext).isFile()) return { path: p + ext };
          return { path: p };
        });
      },
    }],
  });
  return import(`file://${out}`);
}

const [cmd, a1, a2] = process.argv.slice(2);
const eng = await loadEngine();
if (cmd === 'coords') {
  fs.mkdirSync(path.dirname(a1), { recursive: true });
  const coords = eng.buildCoords(UK, eng.FETCH_STEP);
  fs.writeFileSync(a1, JSON.stringify(coords));
  console.log(`coords: ${coords.length}`);
} else if (cmd === 'score') {
  const input = JSON.parse(zlib.gunzipSync(fs.readFileSync(a1)).toString());
  const payload = eng.buildTCMFromPoints({ input, bbox: UK, gridStep: eng.FETCH_STEP, maxDay: 2 });
  if (payload.grid.length < Number(process.env.V3_MIN_CELLS || 80)) throw new Error(`only ${payload.grid.length} cells scored — refusing to publish`);
  payload.region = 'uk';
  const { rows } = await import('./base44-stub.mjs');
  await eng.saveTCMRunToDB('uk', new Date(payload.runStartMs), payload);
  fs.mkdirSync(a2, { recursive: true });
  fs.writeFileSync(path.join(a2, 'payload.json.gz'), zlib.gzipSync(JSON.stringify(payload)));
  fs.writeFileSync(path.join(a2, 'db-rows.json.gz'), zlib.gzipSync(JSON.stringify(rows())));
  const s = payload.summary || {};
  console.log(`scored ${payload.grid.length} cells from ${payload.models.join(', ')}; db rows ${rows().length}; summary ${JSON.stringify(s).slice(0, 200)}`);
} else {
  console.error('usage: build.mjs coords <out> | score <points.json.gz> <outdir>');
  process.exit(2);
}
