/* A graphic's description, made safe and plain for the page's own styles. Descriptions are often
   pasted from X or a web page and arrive wrapped in that site's markup: inline black backgrounds,
   fixed widths, empty boxes hundreds of pixels tall. Only text formatting survives here — a short
   list of tags, no attributes but a link's http(s) address and a colour from the editor's palette,
   empty blocks dropped — so the text takes the glass page's colours, and nothing in it can run. */

/* The text colours the description editors offer (the add / update sheet on the home page and the
   archive's edit form). A colour picked there is kept when the description is shown; it used to be
   stripped with every other attribute, so the colours never appeared. Any other colour is still
   dropped: pasted text brings its page's colours (near-white on X's black), which would vanish on
   the light theme. */
export const TEXT_COLOURS = [
  { label: 'White', value: '#f8fafc' }, { label: 'Silver', value: '#cbd5e1' }, { label: 'Slate', value: '#94a3b8' },
  { label: 'Graphite', value: '#64748b' }, { label: 'Black', value: '#0f172a' }, { label: 'Sky', value: '#38bdf8' },
  { label: 'Cyan', value: '#22d3ee' }, { label: 'Azure', value: '#0ea5e9' }, { label: 'Blue', value: '#3b82f6' },
  { label: 'Indigo', value: '#6366f1' }, { label: 'Violet', value: '#8b5cf6' }, { label: 'Purple', value: '#a855f7' },
  { label: 'Fuchsia', value: '#d946ef' }, { label: 'Pink', value: '#ec4899' }, { label: 'Rose', value: '#f43f5e' },
  { label: 'Red', value: '#ef4444' }, { label: 'Crimson', value: '#dc2626' }, { label: 'Orange', value: '#f97316' },
  { label: 'Amber', value: '#f59e0b' }, { label: 'Gold', value: '#fbbf24' }, { label: 'Yellow', value: '#facc15' },
  { label: 'Lime', value: '#84cc16' }, { label: 'Green', value: '#22c55e' }, { label: 'Emerald', value: '#10b981' },
  { label: 'Dark Green', value: '#15803d' }, { label: 'Teal', value: '#14b8a6' }, { label: 'Mint', value: '#5eead4' },
  { label: 'Brown', value: '#92400e' }, { label: 'Sand', value: '#d6c39a' },
];
const PALETTE = new Set(TEXT_COLOURS.map((c) => c.value));
/* white and silver were picked to stand out on the dark glass, black on a light one: on the other
   theme they would disappear, so they are marked and the page shows them in its own ink there
   (see RICH_TEXT_CSS) */
const INK = { '#f8fafc': 'light', '#cbd5e1': 'light', '#0f172a': 'dark' };

/* "#abc", "#aabbcc" or "rgb(r, g, b)" as "#aabbcc"; null when it is none of those */
function hexOf(c) {
  const t = String(c || '').trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(t);
  if (m) return `#${m[1].replace(/./g, (x) => x + x)}`;
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(t);
  return m ? `#${m.slice(1, 4).map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('')}` : null;
}
/* the palette colour an element was given (by <font color> or a color style), if it is one */
function paletteColour(el) {
  const c = hexOf(el.tagName === 'FONT' ? el.getAttribute('color') : null) || hexOf(el.style?.color);
  return c && PALETTE.has(c) ? c : null;
}
/* WCAG relative luminance of a #rrggbb colour */
const luminance = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
function paint(el, c) {
  el.setAttribute('data-c', '');
  el.style.color = c;
  el.style.setProperty('--c', c);
  if (INK[c]) el.setAttribute('data-ink', INK[c]);
  else if (luminance(c) < 0.12) el.setAttribute('data-deep', '');     // brown: too dark to read on the dark glass
}

/** The colours on whichever page shows a description: on the light theme the palette is darkened a
    little so pale picks (yellow, sand) still read, on the dark one the deepest (brown) is lifted, and
    white or black becomes the page's own ink.
    `light` and `dark` are the selectors that mean each theme on that page. */
export const richTextCss = (scope, light, dark) => `
${light} ${scope} [data-c] { color: color-mix(in srgb, var(--c) 78%, #0b1220) !important; }
${dark} ${scope} [data-deep] { color: color-mix(in srgb, var(--c) 62%, #ffffff) !important; }
${light} ${scope} [data-ink='light'], ${dark} ${scope} [data-ink='dark'] { color: inherit !important; }
`;

const KEEP = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'A', 'UL', 'OL', 'LI', 'H3', 'H4', 'BLOCKQUOTE', 'DIV', 'SPAN']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'IMG', 'VIDEO', 'AUDIO', 'SVG', 'CANVAS', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META']);
const BLOCK = new Set(['P', 'DIV', 'LI', 'H3', 'H4', 'BLOCKQUOTE', 'UL', 'OL']);

function tidy(node) {
  for (const el of [...node.children]) {
    if (DROP.has(el.tagName)) { el.remove(); continue; }
    tidy(el);
    const colour = paletteColour(el);
    if (el.tagName === 'FONT' && colour) {                               // the editor's colour, as a <span>
      const n = el.ownerDocument.createElement('SPAN');
      paint(n, colour);
      n.append(...el.childNodes);
      el.replaceWith(n);
      continue;
    }
    if (!KEEP.has(el.tagName)) {
      /* a heading of another size, a table cell, a pasted <section>: keep what it says */
      const swap = /^H[1256]$/.test(el.tagName) ? 'H4' : BLOCK.has(el.tagName) || /^(SECTION|ARTICLE|HEADER|FOOTER|TD|TH|TR|TABLE|TBODY|FIGURE|FIGCAPTION|PRE)$/.test(el.tagName) ? 'DIV' : null;
      if (swap) {
        const n = el.ownerDocument.createElement(swap);
        n.append(...el.childNodes);
        el.replaceWith(n);
      } else el.replaceWith(...el.childNodes);
      continue;
    }
    const href = el.tagName === 'A' ? el.getAttribute('href') : null;
    for (const a of [...el.attributes]) el.removeAttribute(a.name);
    if (el.tagName === 'A') {
      if (href && /^https?:\/\//i.test(href.trim())) {
        el.setAttribute('href', href.trim());
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer nofollow');
      } else el.replaceWith(...el.childNodes);
      continue;
    }
    if (colour) paint(el, colour);
    if (BLOCK.has(el.tagName) && !el.textContent.trim() && !el.querySelector('br')) el.remove();
  }
}

export function cleanHtml(html) {
  if (!html || typeof html !== 'string') return '';
  if (!/[<&]/.test(html)) return html.replace(/\n/g, '<br>');          // plain text keeps its line breaks
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, '');
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  tidy(doc.body);
  /* runs of empty lines add nothing */
  return doc.body.innerHTML.replace(/(<br>\s*){3,}/g, '<br><br>').trim();
}

/** The text alone, for a card's preview or a search. */
export function plainText(html) {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return (new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();
}
