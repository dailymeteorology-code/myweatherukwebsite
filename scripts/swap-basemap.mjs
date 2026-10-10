/**
 * Swap the CARTO basemap for Esri's keyless canvas basemaps.
 *
 * CARTO began watermarking its no-key tiles with "API KEY REQUIRED" straight
 * across the map. Esri's Canvas basemaps are the closest keyless equivalent:
 * same neutral light/dark cartography meant to sit under data, served over
 * CORS (which the Weather Patterns PNG export needs), no signup.
 *
 * Two shape differences the replacements have to respect:
 *   - Esri orders tiles {z}/{y}/{x}, not {z}/{x}/{y}
 *   - Esri has no @2x/{r} retina variant, and no file extension
 *
 * Re-runnable, and safe to run again after a fresh Base44 export re-introduces
 * the CARTO URLs:  node scripts/swap-basemap.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

/** CARTO style -> Esri service. Labelled and unlabelled collapse together:
 *  Esri splits labels into a separate Reference overlay. */
const STYLE = {
  dark_all: 'Canvas/World_Dark_Gray_Base',
  light_all: 'Canvas/World_Light_Gray_Base',
  dark_nolabels: 'Canvas/World_Dark_Gray_Base',
  light_nolabels: 'Canvas/World_Light_Gray_Base',
  dark_only_labels: 'Canvas/World_Dark_Gray_Reference',
  light_only_labels: 'Canvas/World_Light_Gray_Reference',
  'rastertiles/voyager_nolabels': 'Canvas/World_Light_Gray_Base',
  'rastertiles/voyager': 'Canvas/World_Light_Gray_Base',
};

const tileUrl = (service) => `${ESRI}/${service}/MapServer/tile/{z}/{y}/{x}`;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(jsx?|tsx?)$/.test(e.name)) out.push(full);
  }
  return out;
}

let changedFiles = 0;
let changedUrls = 0;

for (const file of walk(SRC)) {
  const before = fs.readFileSync(file, 'utf8');
  if (!before.includes('cartocdn')) continue;
  let after = before;

  // 1. Plain literal tile URLs, with or without the {r} retina suffix.
  for (const [style, service] of Object.entries(STYLE)) {
    const re = new RegExp(
      `https://\\{s\\}\\.basemaps\\.cartocdn\\.com/${style.replace('/', '\\/')}/\\{z\\}/\\{x\\}/\\{y\\}(\\{r\\})?\\.png`,
      'g'
    );
    after = after.replace(re, () => {
      changedUrls += 1;
      return tileUrl(service);
    });
  }

  // 2. TCM.jsx builds the style from a `tileTheme` variable and appends a
  //    retina suffix. Point the variable at Esri services and drop the suffix.
  after = after.replace(
    /const tileTheme = lightMode \? 'light_all' : 'dark_all';/g,
    () => {
      changedUrls += 1;
      return `const tileTheme = lightMode ? '${STYLE.light_all}' : '${STYLE.dark_all}';`;
    }
  );
  after = after.replace(
    /`https:\/\/\{s\}\.basemaps\.cartocdn\.com\/\$\{tileTheme\}\/\{z\}\/\{x\}\/\{y\}\$\{retinaParam\}\.png`/g,
    () => {
      changedUrls += 1;
      return '`' + ESRI + '/${tileTheme}/MapServer/tile/{z}/{y}/{x}`';
    }
  );

  // 3. WeatherPatterns fetches tiles by hand for the PNG export.
  after = after.replace(
    /const tileStyle = lightMode \? 'light_nolabels' : 'dark_nolabels';/g,
    () => {
      changedUrls += 1;
      return `const tileStyle = lightMode ? '${STYLE.light_nolabels}' : '${STYLE.dark_nolabels}';`;
    }
  );
  after = after.replace(
    /`https:\/\/\$\{s\}\.basemaps\.cartocdn\.com\/\$\{tileStyle\}\/\$\{z\}\/\$\{tx\}\/\$\{ty\}\.png`/g,
    () => {
      changedUrls += 1;
      return '`' + ESRI + '/${tileStyle}/MapServer/tile/${z}/${ty}/${tx}`';
    }
  );

  // 4. Attribution should name who is actually serving the tiles.
  after = after
    .replace(/© OSM © CARTO/g, '© Esri')
    .replace(/&copy; OSM &copy; CARTO/g, '&copy; Esri')
    .replace(/©OpenStreetMap, ©CartoDB/g, '© Esri')
    .replace(/CARTO/g, 'Esri');

  if (after !== before) {
    fs.writeFileSync(file, after);
    changedFiles += 1;
    console.log(`  ${path.relative(SRC, file)}`);
  }
}

const leftovers = walk(SRC).filter((f) => fs.readFileSync(f, 'utf8').includes('cartocdn'));
console.log(`\n${changedUrls} URL(s) rewritten across ${changedFiles} file(s).`);
if (leftovers.length) {
  console.log('\nSTILL REFERENCING cartocdn — handle these by hand:');
  for (const f of leftovers) console.log(`  ${path.relative(SRC, f)}`);
  process.exitCode = 1;
} else {
  console.log('No cartocdn references remain.');
}
