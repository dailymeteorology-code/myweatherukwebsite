/* The site in another language, applied to the page as it renders.

   The pages are written in English. A language's dictionary (strings/<code>.json, made from the
   site's own text by tools/i18n/extract.mjs) maps that English to the language:

     text       whole pieces of text, as they appear in a text node or an attribute
     patterns   text with values in it, each value as {0}, {1}… ("{0} min read")
     words      month and weekday names, for dates the browser writes in English

   A MutationObserver translates every text node and every placeholder, title, aria-label and alt
   as it appears or changes, and the page title. Only the node's value is changed, never the node,
   so React keeps working on the same nodes; when React writes new English the observer translates
   it again. Switching back to English puts every original back. Anything marked translate="no" (or
   class "notranslate"), and code, inputs and editable text, are left alone. */

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'KBD', 'SAMP']);

let dict = null;            // the language now on the page, compiled
let observer = null;
let titleObserver = null;
const nodes = new WeakMap(); // text node -> { src, out }
const attrs = new WeakMap(); // element -> { [attr]: { src, out } }
const seen = new Set();      // text nodes and elements changed, to put back (pruned as they leave the page)

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A dictionary, ready to use: patterns as regular expressions, bucketed by their first word.
    code is the language: German keeps a capital where English had lower case (its nouns), and
    Chinese has no case. */
export function compile(raw, code) {
  const text = new Map(Object.entries(raw.text || {}));
  const words = raw.words || {};
  const buckets = new Map(), leading = [];
  for (const [src, out] of Object.entries(raw.patterns || {})) {
    const re = new RegExp(`^${src.split(/(\{\d+\})/).map((p) => (/^\{\d+\}$/.test(p) ? '(.*?)' : esc(p))).join('')}$`, 's');
    const order = [...src.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
    const entry = { re, out, order, fixed: src.replace(/\{\d+\}/g, '').length };
    const first = src.match(/^[^{\s]+/)?.[0];
    if (first) { if (!buckets.has(first)) buckets.set(first, []); buckets.get(first).push(entry); } else leading.push(entry);
  }
  /* the most specific first: "gusts near {0} mph" before "gusts {0} mph" */
  const bySpecific = (a, b) => b.fixed - a.fixed;
  for (const list of buckets.values()) list.sort(bySpecific);
  leading.sort(bySpecific);
  const wordRe = Object.keys(words).length ? new RegExp(`\\b(${Object.keys(words).sort((a, b) => b.length - a.length).map(esc).join('|')})\\b`, 'g') : null;
  return { text, words, wordRe, buckets, leading, lowerFirst: !['de', 'zh'].includes(code), comma: code === 'zh' ? '，' : ', ', cache: new Map() };
}

/* a lowercase English word that is not a unit or a time ("the", "next"; not "min" or "pm") */
const UNITS = new Set(['min', 'mins', 'mph', 'kph', 'kmh', 'hrs', 'sec', 'secs', 'kts', 'utc', 'bst', 'gmt']);
const englishLeft = (v) => v.split(/[^A-Za-z]+/).some((w) => /^[a-z]{3,}$/.test(w) && !UNITS.has(w));

/* text the code lowercased ("elevated lightning risk"), found under its capital, and lowercased again */
function lowered(d, s) {
  if (!/^[a-z]/.test(s)) return null;
  const out = d.text.get(s.charAt(0).toUpperCase() + s.slice(1));
  if (out == null) return null;
  return d.lowerFirst ? out.charAt(0).toLowerCase() + out.slice(1) : out;
}

/* dates and times as the browser writes them: only names, numbers and punctuation */
const DATEISH = /^[\p{L}\s\d,.:–\-/()+]+$/u;
function dateWords(d, s) {
  if (!d.wordRe || !DATEISH.test(s)) return null;
  const rest = s.replace(d.wordRe, '').replace(/\b(at|am|pm|BST|GMT|UTC)\b/gi, '');
  if (/\p{L}/u.test(rest)) return null;
  d.wordRe.lastIndex = 0;
  const out = s.replace(d.wordRe, (w) => d.words[w]);
  return out === s ? null : out;
}

/** A piece of English in the language on the page, or null to leave it as it is. */
export function translate(d, s) {
  if (!d) return null;
  const core = s.replace(/\s+/g, ' ').trim();
  if (!core || !/\p{L}/u.test(core)) return null;
  let out = d.cache.get(core);
  if (out === undefined) {
    out = d.text.get(core) ?? lowered(d, core);
    if (out == null) {
      const first = core.match(/^[^\s]+/)?.[0];
      for (const e of [...(d.buckets.get(first) || []), ...d.leading]) {
        const m = core.match(e.re);
        if (!m) continue;
        /* each value is translated too, when it is text ("{0} Risk" with "High"). A value running
           across a " · " or into the next sentence (those are for the splits below), or still
           holding English words, means the pattern is too loose for this text: the next is tried */
        const vals = e.order.map((_, k) => m[k + 1] ?? '');
        const done = vals.map((v) => translate(d, v));
        if (vals.some((v, k) => v.includes(' · ') || /[.!?] [A-Z]/.test(v) || (done[k] == null && englishLeft(v)))) continue;
        out = e.out.replace(/\{(\d+)\}/g, (_, i) => { const k = e.order.indexOf(Number(i)); return done[k] ?? vals[k]; });
        break;
      }
    }
    if (out == null) out = dateWords(d, core);
    /* pieces joined with " · " in the code ("3 warnings in force · 3 upcoming"): each on its own */
    if (out == null && core.includes(' · ')) {
      const parts = core.split(' · ');
      const done = parts.map((p) => translate(d, p));
      if (done.some((t) => t != null)) out = parts.map((p, i) => done[i] ?? p).join(' · ');
    }
    /* sentences built one after another ("Light rain, clearing by 21:00. Gusts up to 44 mph around 15:00.") */
    if (out == null && /[.!?] [A-Z]/.test(core)) {
      const parts = core.split(/(?<=[.!?]) (?=[A-Z])/);
      const done = parts.map((p) => translate(d, p));
      if (done.some((t) => t != null)) out = parts.map((p, i) => done[i] ?? p).reduce((a, b) => a + (/[。！？]$/.test(a) ? '' : ' ') + b);
    }
    /* a list joined with ", " ("peak CAPE around 501 J/kg, gusts near 63 mph"): only when every item has a translation */
    if (out == null && core.includes(', ')) {
      const done = core.split(', ').map((p) => translate(d, p));
      if (done.every((t) => t != null)) out = done.join(d.comma);
    }
    if (d.cache.size > 20000) d.cache.clear();
    d.cache.set(core, out);
  }
  if (out == null) return null;
  const lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0];
  return lead + out + tail;
}

const skipped = (el) => {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (SKIP.has(e.tagName) || e.isContentEditable || e.getAttribute?.('translate') === 'no' || e.classList?.contains('notranslate')) return true;
  }
  return false;
};

function doText(n) {
  const rec = nodes.get(n), cur = n.nodeValue;
  if (rec && cur === rec.out) return;                 // our own translation
  if (!dict || !cur || skipped(n.parentElement)) { if (rec) nodes.delete(n); return; }
  const out = translate(dict, cur);
  if (out == null || out === cur) { if (rec) nodes.delete(n); return; }
  nodes.set(n, { src: cur, out });
  seen.add(n);
  n.nodeValue = out;
}

function doAttr(el, a) {
  const cur = el.getAttribute(a);
  const recs = attrs.get(el) || {};
  if (recs[a] && cur === recs[a].out) return;
  if (!dict || cur == null || skipped(el)) { delete recs[a]; return; }
  const out = translate(dict, cur);
  if (out == null || out === cur) { delete recs[a]; return; }
  recs[a] = { src: cur, out };
  attrs.set(el, recs);
  seen.add(el);
  el.setAttribute(a, out);
}

function walk(root) {
  if (root.nodeType === Node.TEXT_NODE) { doText(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE || SKIP.has(root.tagName)) return;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = tw.currentNode; n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n);
    else for (const a of ATTRS) if (n.hasAttribute(a)) doAttr(n, a);
  }
}

function onMutations(list) {
  for (const m of list) {
    if (m.type === 'characterData') doText(m.target);
    else if (m.type === 'attributes') doAttr(m.target, m.attributeName);
    else for (const n of m.addedNodes) walk(n);
  }
}

/* the page title, which lives in <head> */
let titleSrc = null;
function doTitle() {
  const cur = document.title;
  if (dict && cur === titleSrc?.out) return;
  if (!dict) return;
  const out = translate(dict, cur);
  titleSrc = out && out !== cur ? { src: cur, out } : null;
  if (titleSrc) document.title = out;
}

/** Put the language `raw` (a dictionary, or null for English) on the page and keep it there. */
export function applyLanguage(raw, code) {
  observer?.disconnect();
  titleObserver?.disconnect();
  /* everything back to English first */
  for (const n of seen) {
    if (n.nodeType === Node.TEXT_NODE) {
      const rec = nodes.get(n);
      if (rec && n.nodeValue === rec.out) n.nodeValue = rec.src;
      nodes.delete(n);
    } else {
      const recs = attrs.get(n) || {};
      for (const [a, r] of Object.entries(recs)) if (n.getAttribute(a) === r.out) n.setAttribute(a, r.src);
      attrs.delete(n);
    }
  }
  seen.clear();
  if (titleSrc && document.title === titleSrc.out) document.title = titleSrc.src;
  titleSrc = null;
  document.documentElement.lang = code || 'en';
  dict = raw ? compile(raw, code) : null;
  if (!dict) return;
  walk(document.body);
  doTitle();
  observer = new MutationObserver(onMutations);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const t = document.querySelector('title');
  if (t) { titleObserver = new MutationObserver(doTitle); titleObserver.observe(t, { subtree: true, childList: true, characterData: true }); }
}

/* nodes React has removed are dropped from the list now and then, so it does not grow without end */
setInterval(() => { for (const n of seen) if (!n.isConnected) seen.delete(n); }, 60000);
