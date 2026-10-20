/* A graphic's description, made safe and plain for the page's own styles. Descriptions are often
   pasted from X or a web page and arrive wrapped in that site's markup: inline black backgrounds,
   fixed widths, empty boxes hundreds of pixels tall. Only text formatting survives here — a short
   list of tags, no attributes but a link's http(s) address, empty blocks dropped — so the text
   takes the glass page's colours, and nothing in it can run. */
const KEEP = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'A', 'UL', 'OL', 'LI', 'H3', 'H4', 'BLOCKQUOTE', 'DIV', 'SPAN']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'IMG', 'VIDEO', 'AUDIO', 'SVG', 'CANVAS', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META']);
const BLOCK = new Set(['P', 'DIV', 'LI', 'H3', 'H4', 'BLOCKQUOTE', 'UL', 'OL']);

function tidy(node) {
  for (const el of [...node.children]) {
    if (DROP.has(el.tagName)) { el.remove(); continue; }
    tidy(el);
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
