/**
 * One-off Met Office warnings refresh: `npm run warnings:refresh`.
 *
 * The server already refreshes on boot and hourly; this is for pulling fresh
 * warnings without restarting it, or for checking the parser by hand.
 */
import db from './db.js';
import getMetOfficeWarnings from './functions/getMetOfficeWarnings.js';

try {
  const result = await getMetOfficeWarnings(db);
  const warnings = result.record?.all_warnings ?? [];
  console.log(`source: ${result.source}`);
  console.log(`warnings in force: ${result.count} (${warnings.length} stored incl. recent)`);
  for (const w of warnings) {
    console.log(`  ${w.severity.padEnd(6)} ${String(w.type).padEnd(14)} ${(w.regions || []).join(', ')}`);
  }
} catch (err) {
  console.error('refresh failed:', err.message);
  process.exitCode = 1;
}
