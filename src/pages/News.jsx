/* ════════════════════════════════════════════════════════════════════════════
   News — public weather-story articles.

   Reads the NewsArticle entity that the admin News tab already writes to, so
   writing an article needs no new tooling: Admin Settings -> News, and it
   appears here once Published is ticked.

   Two views in one page, no routing needed: a list of published articles, and
   a reading view for whichever is open. Keeping it in one component means an
   article link can be shared as ?a=<id> and land directly on the piece.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { Newspaper, ArrowLeft, Calendar, ExternalLink, Loader2, Home, ChevronRight } from 'lucide-react';

const C = {
  bg: '#05090f', surface: '#0c1422', border: 'rgba(148,163,184,0.12)',
  text: '#f1f5f9', mid: '#94a3b8', faint: '#64748b', accent: '#38bdf8',
};
const FONT = "'DM Sans', system-ui, sans-serif";

const CATEGORY_COLOR = {
  Analysis: '#38bdf8', Storm: '#f87171', Climate: '#34d399',
  Forecast: '#a78bfa', Update: '#fbbf24',
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB',
    { day: 'numeric', month: 'long', year: 'numeric' });
};

/* An image that removes itself if the URL 404s, rather than leaving a broken
   icon and stretched alt text in the middle of the article. */
function ArticleImage({ src, alt }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} style={{
      width: '100%', borderRadius: 12, display: 'block',
      border: '1px solid rgba(148,163,184,0.18)', background: '#fff',
    }} />
  );
}

/* Articles are stored as plain text. Render blank-line-separated blocks as
   paragraphs, and treat a line wrapped in ** ** as a section heading, so a
   long piece has structure without needing a rich-text editor. */
function ArticleBody({ text }) {
  const blocks = useMemo(() => (text || '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean), [text]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {blocks.map((b, i) => {
        /* [[img:URL]] or [[img:URL|caption]] at the start of a block places a
           figure inline, so a long piece can put each graphic beside the
           paragraph that discusses it.

           Any text AFTER the closing ]] is taken as the caption too. That form
           happens naturally: the editor's upload button inserts a bare
           [[img:URL]] and the caption ends up butted against it. An earlier
           version anchored the pattern to the end of the block, so those markers
           matched nothing and rendered as raw text on the page. */
        const img = b.match(/^\[\[img:([^|\]]+?)(?:\|([\s\S]*?))?\]\]([\s\S]*)$/);
        if (img) {
          const [, rawSrc, inlineCaption, trailing] = img;
          const caption = (inlineCaption || trailing || '').trim() || null;
          const src = rawSrc.trim();
          // A marker whose URL was never filled in should not render a broken
          // image with alt text sprawled across it. Show the caption alone.
          const usable = /^(https?:\/\/|\/)/i.test(src);
          return (
            <figure key={i} style={{ margin: '10px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {usable && <ArticleImage src={src} alt={caption ? caption.trim() : ''} />}
              {caption && (
                <figcaption style={{
                  fontSize: 12.5, lineHeight: 1.6, color: '#94a3b8',
                  borderLeft: '2px solid rgba(56,189,248,0.5)', paddingLeft: 11,
                }}>{caption.trim()}</figcaption>
              )}
            </figure>
          );
        }
        const heading = b.match(/^\*\*(.+)\*\*$/);
        if (heading) {
          return (
            <h2 key={i} style={{
              margin: '14px 0 0', fontSize: 19, fontWeight: 800, color: C.text,
              letterSpacing: '-0.01em', lineHeight: 1.3,
            }}>{heading[1]}</h2>
          );
        }
        // A line starting with "- " begins a bullet list block.
        if (/^-\s/.test(b)) {
          return (
            <ul key={i} style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {b.split('\n').map((li, k) => (
                <li key={k} style={{ fontSize: 15, lineHeight: 1.7, color: 'rgba(226,232,240,0.9)' }}>
                  {li.replace(/^-\s*/, '')}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} style={{ margin: 0, fontSize: 15.5, lineHeight: 1.75, color: 'rgba(226,232,240,0.88)' }}>
            {b}
          </p>
        );
      })}
    </div>
  );
}

/* Breadcrumb + escape routes. A reader landing on a shared article link has no
   other way back into the site, so the page carries its own navigation rather
   than relying on the browser's back button. */
function Breadcrumb({ onBack, backLabel }) {
  const linkCss = {
    display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none',
    fontSize: 12.5, fontWeight: 700, color: C.mid, fontFamily: FONT,
    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
      {onBack && (
        <>
          <button type="button" onClick={onBack} style={linkCss}>
            <ArrowLeft style={{ width: 14, height: 14 }} /> {backLabel || 'Back'}
          </button>
          <ChevronRight style={{ width: 12, height: 12, color: C.faint }} />
        </>
      )}
      <Link to="/" style={linkCss}>
        <Home style={{ width: 13, height: 13 }} /> Home
      </Link>
    </div>
  );
}

export default function News() {
  const [openId, setOpenId] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('a'); } catch { return null; }
  });

  const { data: articles, isLoading } = useQuery({
    queryKey: ['news-articles'],
    queryFn: async () => {
      const all = await base44.entities.NewsArticle.list('-published_at');
      return (all || []).filter(a => a.published);
    },
  });

  const open = useMemo(
    () => (openId ? (articles || []).find(a => a.id === openId) : null),
    [openId, articles],
  );

  // Keep the URL in step so an article can be linked to directly.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (openId) url.searchParams.set('a', openId); else url.searchParams.delete('a');
      window.history.replaceState({}, '', url);
    } catch { /* history unavailable */ }
  }, [openId]);

  useEffect(() => { window.scrollTo(0, 0); }, [openId]);

  const wrap = { minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.text };
  const inner = { maxWidth: 780, margin: '0 auto', padding: '40px 22px 80px' };

  if (isLoading) {
    return (
      <div style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 style={{ width: 22, height: 22, color: C.accent, animation: 'spin 0.8s linear infinite' }} />
        <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      </div>
    );
  }

  /* ── Reading view ── */
  if (open) {
    const accent = CATEGORY_COLOR[open.category] || C.accent;
    return (
      <div style={wrap}>
        <div style={inner}>
          <Breadcrumb onBack={() => setOpenId(null)} backLabel="All stories" />

          {open.category && (
            <span style={{
              display: 'inline-block', padding: '4px 11px', borderRadius: 999, marginBottom: 14,
              fontSize: 10, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase',
              background: `${accent}1a`, border: `1px solid ${accent}55`, color: accent,
            }}>{open.category}</span>
          )}

          <h1 style={{
            margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em',
            lineHeight: 1.15, color: C.text, textWrap: 'balance',
          }}>{open.title}</h1>

          <p style={{ margin: '14px 0 0', fontSize: 12.5, color: C.faint, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Calendar style={{ width: 13, height: 13 }} /> {fmtDate(open.published_at)}
          </p>

          {open.image_url && (
            <img src={open.image_url} alt="" style={{
              width: '100%', borderRadius: 14, marginTop: 26,
              border: `1px solid ${C.border}`, display: 'block',
            }} />
          )}

          <div style={{ marginTop: 28 }}>
            <ArticleBody text={open.body} />
          </div>

          {open.link_url && (
            <a href={open.link_url} target="_blank" rel="noopener noreferrer" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 32,
              padding: '11px 18px', borderRadius: 10, textDecoration: 'none',
              background: `${accent}18`, border: `1px solid ${accent}55`, color: accent,
              fontSize: 13.5, fontWeight: 700,
            }}>
              {open.link_label || 'Read more'} <ExternalLink style={{ width: 14, height: 14 }} />
            </a>
          )}
        </div>
      </div>
    );
  }

  /* ── List view ── */
  return (
    <div style={wrap}>
      <div style={inner}>
        <Breadcrumb />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Newspaper style={{ width: 19, height: 19, color: C.accent }} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 27, fontWeight: 800, letterSpacing: '-0.03em' }}>Weather News</h1>
            <p style={{ margin: '3px 0 0', fontSize: 13, color: C.mid }}>
              Analysis and stories from the UK &amp; Ireland
            </p>
          </div>
        </div>

        {!articles?.length ? (
          <p style={{ marginTop: 40, fontSize: 14, color: C.faint }}>No stories published yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 32 }}>
            {articles.map(a => {
              const accent = CATEGORY_COLOR[a.category] || C.accent;
              const preview = (a.body || '').replace(/\*\*/g, '').split(/\n{2,}/)[0];
              return (
                <button key={a.id} type="button" onClick={() => setOpenId(a.id)} style={{
                  textAlign: 'left', cursor: 'pointer', fontFamily: FONT,
                  background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 14, padding: 20, display: 'flex', gap: 18, alignItems: 'flex-start',
                  transition: 'border-color 0.15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = `${accent}55`; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}
                >
                  {a.image_url && (
                    <img src={a.image_url} alt="" style={{
                      width: 116, height: 80, objectFit: 'cover', borderRadius: 9,
                      flexShrink: 0, border: `1px solid ${C.border}`,
                    }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7, flexWrap: 'wrap' }}>
                      {a.category && (
                        <span style={{
                          fontSize: 9.5, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase',
                          padding: '3px 8px', borderRadius: 5,
                          background: `${accent}1a`, border: `1px solid ${accent}44`, color: accent,
                        }}>{a.category}</span>
                      )}
                      <span style={{ fontSize: 11.5, color: C.faint, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Calendar style={{ width: 11, height: 11 }} /> {fmtDate(a.published_at)}
                      </span>
                    </div>
                    <h2 style={{ margin: 0, fontSize: 17.5, fontWeight: 700, color: C.text, lineHeight: 1.3, letterSpacing: '-0.01em' }}>
                      {a.title}
                    </h2>
                    <p style={{
                      margin: '7px 0 0', fontSize: 13.5, color: C.mid, lineHeight: 1.6,
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>{preview}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}