// Install a locally built V3 run into the RUNNING site (its in-memory DB is authoritative,
// so rows must go through the server, never straight into db.json):
//   node tools/tcm-v3/publish-local.mjs <outdir with payload.json.gz + db-rows.json.gz>
import path from 'node:path';
const dir = path.resolve(process.argv[2]);
const r = await fetch(`http://127.0.0.1:8787/api/tcm-v3/install-local?dir=${encodeURIComponent(dir)}`, { method: 'POST' });
console.log(r.status, await r.text());
if (!r.ok) process.exit(1);
