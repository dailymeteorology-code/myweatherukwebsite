/* A News article's text, as the admin News editor writes it: plain text in blocks separated by a
   blank line.

     **Heading**              a block that is one bold line is a section heading
     - item / 1. item         a block of lines starting "- " or "1. " is a list
     > quote                  a block starting "> " is a pull quote
     [[img:URL|caption]]      a figure; text after the closing ]] is the caption too (the editor's
                              upload button inserts a bare [[img:URL]] and the caption follows it)

   Inside a paragraph, **words** are bold and a web address becomes a link. Everything is built
   as React elements, never as HTML, so an article cannot inject markup. */
import React, { useMemo, useState } from 'react';

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** The article's blocks, worked out once: what each is and its text. Headings get unique ids. */
export function parseArticle(text) {
  const ids = new Set();
  const uniq = (s) => { let id = slug(s) || 'section', n = 2; while (ids.has(id)) id = `${slug(s)}-${n++}`; ids.add(id); return id; };
  return (text || '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).map((b) => {
    const img = b.match(/^\[\[img:([^|\]]+?)(?:\|([\s\S]*?))?\]\]([\s\S]*)$/);
    if (img) {
      const src = img[1].trim();
      return { kind: 'img', src: /^(https?:\/\/|\/)/i.test(src) ? src : null, caption: (img[2] || img[3] || '').trim() || null };
    }
    const h = b.match(/^\*\*([^\n]+)\*\*$/);
    if (h) return { kind: 'h', text: h[1].trim(), id: uniq(h[1]) };
    if (/^-\s/.test(b)) return { kind: 'ul', items: b.split('\n').map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean) };
    if (/^\d+[.)]\s/.test(b)) return { kind: 'ol', items: b.split('\n').map((l) => l.replace(/^\d+[.)]\s*/, '').trim()).filter(Boolean) };
    if (/^>\s?/.test(b)) return { kind: 'quote', text: b.split('\n').map((l) => l.replace(/^>\s?/, '')).join(' ') };
    return { kind: 'p', text: b };
  });
}

/** Bold and links inside a run of text. */
function Inline({ text }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|https?:\/\/[^\s<>()]+)/g);
  return parts.map((t, i) => {
    if (!t) return null;
    if (/^\*\*[^*]+\*\*$/.test(t)) return <strong key={i}>{t.slice(2, -2)}</strong>;
    if (/^https?:\/\//.test(t)) {
      const url = t.replace(/[.,;:!?'"]+$/, ''), rest = t.slice(url.length);
      return <React.Fragment key={i}><a href={url} target="_blank" rel="noopener noreferrer">{url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a>{rest}</React.Fragment>;
    }
    return <React.Fragment key={i}>{t}</React.Fragment>;
  });
}

/* a picture that takes itself away if its address is broken, rather than leaving a broken icon */
function Figure({ src, caption }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return caption ? <figure className="nw-fig"><figcaption>{caption}</figcaption></figure> : null;
  return (
    <figure className="nw-fig">
      <a href={src} target="_blank" rel="noopener noreferrer" aria-label="Open the picture full size">
        <img src={src} alt={caption || ''} loading="lazy" onError={() => setFailed(true)} />
      </a>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

export default function ArticleBody({ text }) {
  const blocks = useMemo(() => parseArticle(text), [text]);
  return (
    <div className="nw-prose">
      {blocks.map((b, i) => {
        if (b.kind === 'img') return <Figure key={i} src={b.src} caption={b.caption} />;
        if (b.kind === 'h') return <h2 key={i} id={b.id}>{b.text}</h2>;
        if (b.kind === 'ul') return <ul key={i}>{b.items.map((x, k) => <li key={k}><Inline text={x} /></li>)}</ul>;
        if (b.kind === 'ol') return <ol key={i}>{b.items.map((x, k) => <li key={k}><Inline text={x} /></li>)}</ol>;
        if (b.kind === 'quote') return <blockquote key={i}><Inline text={b.text} /></blockquote>;
        return <p key={i}><Inline text={b.text} /></p>;
      })}
    </div>
  );
}
