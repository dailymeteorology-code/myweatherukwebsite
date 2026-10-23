/* The site's English text, for the translations in src/lib/i18n/strings.

   Walks the source from the app's entry (src/main.jsx) through every import a visitor's pages
   reach, leaving out the admin-only pages (Admin Settings, the Dashboard, the live-stream surface,
   the TCM NOVA admin view) and data modules (place names). It collects:
     - JSX text, and string literals in text attributes (placeholder, title, aria-label, alt, label…)
       and in text properties of objects ({ label: 'Rain', desc: '…' })
     - other string literals that read as text (a capital or a space), in JSX and in arrays, and
       any literal shown as a JSX child or a text attribute, even one lowercase word ('updated')
     - template literals as patterns, each ${…} as {0}, {1}… ("{0} min read")
     - the server's user-facing error messages (json({ error: '…' }))

   Usage:  node tools/i18n/extract.mjs            writes tools/i18n/strings.json
           node tools/i18n/extract.mjs --missing  also lists what each language lacks */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const SRC = path.join(ROOT, 'src');
const require = createRequire(import.meta.url);
const parser = require(path.join(ROOT, 'node_modules/@babel/parser'));
const traverse = require(path.join(ROOT, 'node_modules/@babel/traverse')).default;

/* never followed: admin-only pages, and data that is not to be translated */
const SKIP = new Set([
  'pages/AdminSettings.jsx', 'pages/Dashboard.jsx', 'pages/LiveStream.jsx', 'pages/TCMNova.jsx',
  'components/tcm/cityDB.jsx', 'components/tcm/ukIrelandMask.jsx',
]);
const TEXT_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'blurb', 'desc', 'description', 'text',
  'tooltip', 'subtitle', 'heading', 'caption', 'hint', 'note', 'message', 'empty', 'what', 'lede', 'busyText', 'backLabel',
  'prefix', 'suffix']);
const TEXT_KEYS = new Set([...TEXT_ATTRS, 'name', 'short', 'long', 'summary', 'detail', 'headline', 'tip', 'help', 'body', 'cta', 'action', 'word', 'reason', 'error']);

const reads = (s) => /[A-Za-z]{2}/.test(s);
/* class lists, paths, colours, ids, CSS and code: not text */
function codey(s, loose = false) {
  const t = s.trim();
  if (!t || !/[A-Za-z]/.test(t)) return true;
  if (/^(https?:|mailto:|data:|\/|#|\.\.?\/|var\(|rgba?\(|hsla?\(|url\(|calc\(|[0-9.]+(px|em|rem|%|vh|vw|s|ms)\b)/i.test(t)) return true;
  if (/[{}<>=]|=>|\$\{|\\n/.test(t)) return true;
  if (/;\S|;$|:\s*[^\s;]+;/.test(t)) return true;                                                                  // a ; in code or CSS, not prose ("above; the map")
  if (/\d+(px|em|rem|vh|vw)\b|sans-serif|monospace|Segoe|BlinkMacSystemFont|translate\(|scale\(|rotate\(/.test(t)) return true;  // CSS, fonts, transforms
  if (/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/.test(t) && /\d/.test(t)) return true;                                    // SVG path data
  if (/^[A-Z][a-z]+([A-Z][a-z]*)+$/.test(t)) return true;                                                          // PascalCase ids
  if (/\w_\w/.test(t) && !/\s/.test(t)) return true;                                                                // snake_case ids
  const toks = t.split(/\s+/);
  if (toks.every((w) => /^[a-z0-9:\-[\]/.%!#_]+$/.test(w)) && toks.some((w) => /[-:]/.test(w))) return true;     // tailwind / class lists
  if (!loose && toks.length === 1 && !/^[A-Z][a-z]/.test(t) && !/^[A-Z]{2,}$/.test(t)) return true;               // a lone lowercase word or id
  if (/^[a-z]+([A-Z][a-z]+)+$/.test(t)) return true;                                                               // camelCase
  if (/^[A-Z_]+$/.test(t) && t.includes('_')) return true;                                                         // CONSTANT_NAMES
  return false;
}
const norm = (s) => s.replace(/\s+/g, ' ').trim();

function resolveImport(from, spec) {
  let p;
  if (spec.startsWith('@/')) p = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) p = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [p, `${p}.jsx`, `${p}.js`, path.join(p, 'index.jsx'), path.join(p, 'index.js')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile() && /\.(jsx|js)$/.test(c)) return c;
  }
  return null;
}

const strings = new Map();      // text -> first file seen
const patterns = new Map();     // "{0} min read" -> file
const visited = new Set();
const queue = [path.join(SRC, 'main.jsx')];

/* text with **bold** is split round the bold on the page, so as a whole it never meets the translator.
   loose: the string is known to be shown (a label, or a JSX child), so a lone lowercase word counts */
function add(s, file, loose = false) { const t = norm(s); if (t.length >= 2 && reads(t) && !codey(t, loose) && !t.includes('**') && !strings.has(t)) strings.set(t, file); }

/* a literal that ends up as a JSX child or a text attribute, through any ?: and && / || on the way
   ({ok ? 'ready' : 'starting'}, note={bad ? 'degraded' : 'published'}) */
function shownInJsx(p) {
  let q = p.parentPath;
  while (q && ['ConditionalExpression', 'LogicalExpression', 'ParenthesizedExpression'].includes(q.node.type)) {
    if (q.node.type === 'ConditionalExpression' && q.node.test === (q === p.parentPath ? p.node : null)) return false;
    q = q.parentPath;
  }
  if (!q || q.node.type !== 'JSXExpressionContainer') return false;
  return ['JSXElement', 'JSXFragment'].includes(q.parent.type) || (q.parent.type === 'JSXAttribute' && TEXT_ATTRS.has(q.parent.name.name));
}
const patternCodey = (t) => t.includes('**') || /[a-z]_\{|\}_|\.(png|jpg|svg)|px\)|in srgb|hPa$|\(\{\d\}/.test(t);

while (queue.length) {
  const file = queue.shift();
  const rel = path.relative(SRC, file).replace(/\\/g, '/');
  if (visited.has(file) || SKIP.has(rel)) continue;
  visited.add(file);
  const code = fs.readFileSync(file, 'utf8');
  let ast;
  try { ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] }); } catch { continue; }
  traverse(ast, {
    ImportDeclaration(p) { const r = resolveImport(file, p.node.source.value); if (r) queue.push(r); },
    CallExpression(p) {
      const c = p.node.callee;
      if (c.type === 'Import' && p.node.arguments[0]?.type === 'StringLiteral') { const r = resolveImport(file, p.node.arguments[0].value); if (r) queue.push(r); }
      if (c.type === 'MemberExpression' && c.object.name === 'console') p.skip();
    },
    JSXText(p) { add(p.node.value, rel); },
    JSXAttribute(p) {
      const name = p.node.name.name;
      if (['className', 'style', 'href', 'src', 'to', 'd', 'id', 'key', 'type', 'role', 'fill', 'stroke', 'viewBox', 'transform', 'points'].includes(name)) p.skip();
    },
    StringLiteral(p) {
      const v = p.node.value;
      const par = p.parent;
      if (par.type === 'ImportDeclaration' || par.type === 'ExportNamedDeclaration' || par.type === 'ExportAllDeclaration') return;
      if (par.type === 'JSXAttribute') { if (TEXT_ATTRS.has(par.name.name)) add(v, rel, true); return; }
      if (par.type === 'ObjectProperty') {
        const key = par.key.name ?? par.key.value;
        if (par.value === p.node && TEXT_KEYS.has(key)) add(v, rel, true);
        else if (par.value === p.node && /[A-Z]/.test(v[0] || '') && /\s/.test(v)) add(v, rel);
        return;
      }
      if (['JSXExpressionContainer', 'ConditionalExpression', 'LogicalExpression', 'ArrayExpression', 'ReturnStatement',
        'ArrowFunctionExpression', 'AssignmentExpression', 'VariableDeclarator', 'BinaryExpression', 'CallExpression', 'NewExpression'].includes(par.type)) {
        if (shownInJsx(p)) add(v, rel, true);
        else if (/\s/.test(v.trim()) || /^[A-Z][a-z]/.test(v.trim())) add(v, rel);
      }
    },
    TemplateLiteral(p) {
      if (p.parent.type === 'TaggedTemplateExpression') return;
      const q = p.node.quasis.map((x) => x.value.cooked);
      if (!p.node.expressions.length) { add(q[0], rel); return; }
      let out = '';
      q.forEach((s, i) => { out += s; if (i < p.node.expressions.length) out += `{${i}}`; });
      const lit = norm(q.join(' '));
      /* one lowercase word set off by a space from its value ("{0} connections") is text, not an id */
      const worded = /^[a-z]{3,}$/.test(lit) && /\}\s+[a-z]|[a-z]\s+\{/.test(out);
      if (!reads(lit) || codey(lit, worded) || /^\{\d\}$/.test(norm(out))) return;
      if (!/[A-Za-z]{2,}\s|\s[A-Za-z]{2,}/.test(` ${lit} `)) return;
      const t = norm(out);
      if (!patternCodey(t) && !patterns.has(t)) patterns.set(t, rel);
    },
  });
}

/* the server's messages that reach the page */
for (const f of fs.readdirSync(path.join(ROOT, 'server')).filter((x) => x.endsWith('.js'))) {
  const code = fs.readFileSync(path.join(ROOT, 'server', f), 'utf8');
  for (const m of code.matchAll(/error:\s*'([^'\\]{4,200})'/g)) add(m[1], `server/${f}`);
}

const out = {
  made: new Date().toISOString(), files: visited.size,
  strings: [...strings.keys()].sort((a, b) => a.localeCompare(b)),
  patterns: [...patterns.keys()].sort((a, b) => a.localeCompare(b)),
};
fs.writeFileSync(path.join(here, 'strings.json'), JSON.stringify(out, null, 1));
console.log(`${out.files} files: ${out.strings.length} strings, ${out.patterns.length} patterns`);

if (process.argv.includes('--missing')) {
  for (const lang of ['es', 'pl', 'zh', 'fr', 'de']) {
    const f = path.join(SRC, 'lib', 'i18n', 'strings', `${lang}.json`);
    const d = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { text: {}, patterns: {} };
    const lacks = out.strings.filter((s) => !(s in d.text)).length + out.patterns.filter((s) => !(s in d.patterns)).length;
    console.log(`${lang}: ${lacks} missing`);
  }
}
