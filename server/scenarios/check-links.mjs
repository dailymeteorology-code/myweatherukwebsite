/**
 * npm run scenarios:check-links — verify every source URL in the catalogue.
 * Exits non-zero if any link fails, listing them.
 */
import { buildCatalogue } from './store.js';
import { checkLinks } from './links.js';

const c = buildCatalogue();
const r = await checkLinks(c.sources);
console.log(`${r.ok}/${r.total} source links OK`);
for (const f of r.failed) console.log(`  FAIL ${f.status} ${f.id} ${f.url}`);
process.exit(r.failed.length ? 1 : 0);
