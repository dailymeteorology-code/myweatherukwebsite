/* News: MyWeatherUK's weather stories.

   Reads the NewsArticle entity the admin News tab writes (Admin Settings -> News); an article
   shows here once Published is ticked. Two views on one page: every story (the newest as the lead,
   a search and the categories), and one story to read, linkable as /News?a=<id>, with a list of
   its sections for long pieces and the stories either side of it. */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Newspaper, Search, X, ArrowLeft, ArrowRight, Calendar, Clock, Share2, Check, ExternalLink, Mail,
  BarChart3, CloudLightning, Thermometer, CloudSun, Megaphone, ListTree,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import NewsShell from '@/components/news/NewsShell';
import ArticleBody, { parseArticle } from '@/components/news/ArticleBody';

/* the NewsArticle categories (the admin editor's NEWS_CATS) */
const CATS = {
  Analysis: { color: '#38bdf8', icon: BarChart3 },
  Storm: { color: '#f87171', icon: CloudLightning },
  Climate: { color: '#34d399', icon: Thermometer },
  Forecast: { color: '#a78bfa', icon: CloudSun },
  Update: { color: '#fbbf24', icon: Megaphone },
};
const catOf = (a) => CATS[a.category] || { color: '#38bdf8', icon: Newspaper };

const CSS = `
.nn-hero { padding: clamp(20px, 3.4vw, 34px); overflow: hidden; }
.nn-hero::before { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background: radial-gradient(110% 90% at 0% 0%, color-mix(in srgb, var(--ad-sky) 16%, transparent), transparent 55%), radial-gradient(90% 80% at 100% 0%, color-mix(in srgb, var(--ad-violet) 13%, transparent), transparent 60%); }
.nn-hero > * { position: relative; }
.nn-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 22px; }
.nn-search { position: relative; flex: 1 1 260px; max-width: 420px; }
.nn-search > svg { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--ad-text-faint); pointer-events: none; }
.nn-search .nw-input { padding-left: 38px; padding-right: 38px; }
.nn-search .nw-input::-webkit-search-cancel-button { -webkit-appearance: none; display: none; }
.nn-search button { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); display: grid; place-items: center; width: 30px; height: 30px; border: 0; border-radius: 9px;
  background: transparent; color: var(--ad-text-dim); cursor: pointer; }
.nn-search button:hover { background: var(--ad-surface2); color: var(--ad-text); }
.nn-search button svg { width: 15px; height: 15px; }
.nn-cats { display: flex; flex-wrap: wrap; gap: 6px; }
.nn-cat { display: inline-flex; align-items: center; gap: 6px; padding: 8px 13px; border-radius: 99px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
  color: var(--ad-text-mid); background: var(--ad-surface3); border: 1px solid var(--ad-border); transition: color .15s, background .15s, border-color .15s; }
.nn-cat:hover { color: var(--ad-text); border-color: var(--ad-border3); }
.nn-cat.on { color: var(--ad-text); background: color-mix(in srgb, var(--k) 16%, var(--ad-surface2)); border-color: color-mix(in srgb, var(--k) 50%, transparent); }
.nn-cat i { width: 8px; height: 8px; border-radius: 50%; background: var(--k); }
.nn-cat small { font-size: 11.5px; color: var(--ad-text-dim); font-weight: 600; }
.nn-art { position: relative; display: grid; place-items: center; overflow: hidden; color: var(--k);
  background: radial-gradient(120% 120% at 20% 10%, color-mix(in srgb, var(--k) 34%, transparent), transparent 60%), linear-gradient(145deg, color-mix(in srgb, var(--k) 20%, var(--ad-surface3)), var(--ad-surface3)); }
.nn-art svg { width: 40%; height: 40%; max-width: 92px; max-height: 92px; opacity: .85; filter: drop-shadow(0 8px 24px color-mix(in srgb, var(--k) 45%, transparent)); }
.nn-art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.nn-lead { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); overflow: hidden; text-decoration: none; color: inherit; transition: border-color .15s, transform .2s; }
.nn-lead:hover { border-color: color-mix(in srgb, var(--k) 45%, var(--ad-border)); transform: translateY(-2px); }
.nn-lead .nn-art { min-height: 300px; }
.nn-lead-text { display: flex; flex-direction: column; gap: 12px; padding: clamp(20px, 3vw, 34px); justify-content: center; }
.nn-lead-text h2 { margin: 0; font-size: clamp(23px, 3vw, 32px); font-weight: 800; letter-spacing: -.025em; line-height: 1.14; text-wrap: balance; }
.nn-lead-text p { margin: 0; font-size: 15px; line-height: 1.6; color: var(--ad-text-mid); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.nn-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
.nn-more { display: inline-flex; align-items: center; gap: 7px; font-size: 13.5px; font-weight: 750; color: var(--ad-sky); }
.nn-more svg { width: 15px; height: 15px; transition: transform .15s; }
.nn-lead:hover .nn-more svg, .nn-card:hover .nn-more svg { transform: translateX(3px); }
.nn-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 16px; }
.nn-card { display: flex; flex-direction: column; overflow: hidden; text-decoration: none; color: inherit; transition: border-color .15s, transform .2s; }
.nn-card:hover { border-color: color-mix(in srgb, var(--k) 45%, var(--ad-border)); transform: translateY(-2px); }
.nn-card .nn-art { height: 150px; }
.nn-card-text { display: flex; flex-direction: column; gap: 10px; padding: 18px 18px 20px; flex: 1; }
.nn-card-text h3 { margin: 0; font-size: 18px; font-weight: 750; letter-spacing: -.015em; line-height: 1.3; }
.nn-card-text p { margin: 0; font-size: 14px; line-height: 1.55; color: var(--ad-text-mid); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.nn-card-text .nn-more { margin-top: auto; padding-top: 4px; }
.nn-cta { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; padding: 22px 24px; }
.nn-cta > span { display: grid; place-items: center; width: 50px; height: 50px; border-radius: 16px; color: var(--ad-sky); background: color-mix(in srgb, var(--ad-sky) 14%, transparent); }
.nn-cta > span svg { width: 24px; height: 24px; }
.nn-cta div { flex: 1 1 240px; }
.nn-cta b { display: block; font-size: 17px; letter-spacing: -.01em; }
.nn-cta p { margin: 4px 0 0; font-size: 13.5px; line-height: 1.5; color: var(--ad-text-mid); }
.nn-read { display: grid; grid-template-columns: minmax(0, 1fr) 250px; gap: 16px; align-items: start; }
.nn-read.no-toc { grid-template-columns: minmax(0, 860px); justify-content: center; }
.nn-article { padding: clamp(20px, 4vw, 48px); min-width: 0; }
.nn-article-top { display: flex; align-items: center; gap: 8px; margin: -6px -6px 22px; }
.nn-article h1 { margin: 14px 0 0; font-size: clamp(28px, 4.6vw, 44px); font-weight: 800; letter-spacing: -.035em; line-height: 1.1; text-wrap: balance; }
.nn-article .nn-row { margin-top: 16px; }
.nn-hero-img { margin: 28px 0 0; border-radius: 18px; overflow: hidden; border: 1px solid var(--ad-border); }
.nn-hero-img img { display: block; width: 100%; height: auto; }
.nn-article .nw-prose { margin-top: 30px; }
.nn-link { margin-top: 32px; }
.nn-toc { position: sticky; top: 78px; padding: 18px; }
.nn-toc b { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--ad-text-dim); margin-bottom: 10px; }
.nn-toc b svg { width: 14px; height: 14px; }
.nn-toc a { display: block; padding: 7px 10px; margin: 0 -10px; border-radius: 10px; font-size: 13.5px; line-height: 1.35; color: var(--ad-text-mid); text-decoration: none; }
.nn-toc a:hover { color: var(--ad-text); background: var(--ad-surface3); }
.nn-pn { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.nn-pn a { display: flex; flex-direction: column; gap: 6px; padding: 18px 20px; text-decoration: none; color: inherit; transition: border-color .15s; }
.nn-pn a:hover { border-color: var(--ad-border3); }
.nn-pn a.next { text-align: right; align-items: flex-end; grid-column: 2; }
.nn-pn small { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--ad-text-dim); }
.nn-pn small svg { width: 14px; height: 14px; }
.nn-pn b { font-size: 16px; line-height: 1.35; letter-spacing: -.01em; }
.nw-prose { font-size: 17px; line-height: 1.75; color: color-mix(in srgb, var(--ad-text) 88%, var(--ad-text-mid)); }
.nw-prose > * { margin: 0; }
.nw-prose > * + * { margin-top: 1.05em; }
.nw-prose > * + h2, .nw-prose > * + .nw-fig { margin-top: 1.8em; }
.nw-prose h2 { font-size: 23px; line-height: 1.25; font-weight: 800; letter-spacing: -.02em; color: var(--ad-text); scroll-margin-top: 84px; }
.nw-prose ul, .nw-prose ol { padding-left: 1.3em; }
.nw-prose li + li { margin-top: .4em; }
.nw-prose li::marker { color: var(--ad-sky); }
.nw-prose strong { color: var(--ad-text); font-weight: 750; }
.nw-prose a { color: var(--ad-sky); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--ad-sky) 40%, transparent); text-underline-offset: 3px; overflow-wrap: anywhere; }
.nw-prose a:hover { text-decoration-color: var(--ad-sky); }
.nw-prose blockquote { padding: 4px 0 4px 18px; border-left: 3px solid var(--ad-sky); font-size: 19px; line-height: 1.6; font-weight: 600; color: var(--ad-text); }
.nw-fig a { display: block; border-radius: 16px; overflow: hidden; border: 1px solid var(--ad-border); background: var(--ad-surface3); }
.nw-fig img { display: block; width: 100%; height: auto; }
.nw-fig figcaption { margin-top: 10px; padding-left: 12px; border-left: 2px solid color-mix(in srgb, var(--ad-sky) 55%, transparent); font-size: 13.5px; line-height: 1.55; color: var(--ad-text-dim); }
@media (max-width: 1000px) { .nn-read { grid-template-columns: minmax(0, 1fr); } .nn-toc { display: none; } }
@media (max-width: 760px) {
  .nn-lead { grid-template-columns: minmax(0, 1fr); }
  .nn-lead .nn-art { min-height: 0; height: 180px; }
  .nn-pn { grid-template-columns: minmax(0, 1fr); }
  .nn-pn a.next { grid-column: 1; }
  .nw-prose { font-size: 16.5px; }
  .nn-search { max-width: none; }
}
`;

const fmtDate = (iso) => {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};
const readMins = (body) => Math.max(1, Math.round((body || '').replace(/\[\[img:[^\]]*\]\]/g, '').split(/\s+/).filter(Boolean).length / 220));
/** A story's picture for its card: its own, or else the first one in its text. */
const coverOf = (a) => a.image_url || parseArticle(a.body).find((b) => b.kind === 'img' && b.src)?.src || null;
/** The first paragraph, as plain text, for a card. */
const preview = (body) => (parseArticle(body).find((b) => b.kind === 'p')?.text || '').replace(/\*\*/g, '');

function Meta({ a }) {
  return (
    <div className="nn-row">
      {a.category && <span className="nw-chip" style={{ '--k': catOf(a).color }}>{a.category}</span>}
      {a.published_at && <span className="nw-meta"><Calendar />{fmtDate(a.published_at)}</span>}
      <span className="nw-meta"><Clock />{readMins(a.body)} min read</span>
    </div>
  );
}

/* the picture of a story, over its category's mark (which shows while it loads, or if it cannot) */
function Art({ a }) {
  const { color, icon: Icon } = catOf(a);
  const src = useMemo(() => coverOf(a), [a]);
  const [broken, setBroken] = useState(false);
  return (
    <div className="nn-art" style={{ '--k': color }} aria-hidden="true">
      <Icon />
      {src && !broken && <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />}
    </div>
  );
}

function NewsletterCta() {
  return (
    <section className="nw-glass nn-cta">
      <span><Mail /></span>
      <div><b>Get the MyWeatherUK newsletter</b><p>Storm outlooks, forecast stories and high-risk alerts by email. Free, and you can leave any time.</p></div>
      <Link to="/NewsletterSignup" className="nw-btn is-primary">Sign up<ArrowRight /></Link>
    </section>
  );
}

function StoryList({ articles }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const counts = useMemo(() => {
    const c = {};
    for (const a of articles) if (a.category) c[a.category] = (c[a.category] || 0) + 1;
    return c;
  }, [articles]);
  const needle = q.trim().toLowerCase();
  const shown = articles.filter((a) => (cat === 'All' || a.category === cat)
    && (!needle || `${a.title} ${a.body}`.toLowerCase().includes(needle)));
  const lead = !needle && cat === 'All' ? shown[0] : null;
  const rest = lead ? shown.slice(1) : shown;

  return (
    <>
      <header className="nw-glass nn-hero">
        <p className="nw-eyebrow"><Newspaper />MyWeatherUK News</p>
        <h1 className="nw-h1">Weather <span>News</span></h1>
        <p className="nw-lede">The stories behind the forecasts: analysis, storms, climate and what is new on MyWeatherUK, for the UK and Ireland.</p>
        <div className="nn-tools">
          <label className="nn-search">
            <Search />
            <input className="nw-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the stories" aria-label="Search the stories" />
            {q && <button type="button" onClick={() => setQ('')} aria-label="Clear the search"><X /></button>}
          </label>
          <div className="nn-cats" role="group" aria-label="Category">
            <button type="button" className={`nn-cat${cat === 'All' ? ' on' : ''}`} style={{ '--k': 'var(--ad-sky)' }} onClick={() => setCat('All')} aria-pressed={cat === 'All'}>All <small>{articles.length}</small></button>
            {Object.keys(CATS).filter((c) => counts[c]).map((c) => (
              <button key={c} type="button" className={`nn-cat${cat === c ? ' on' : ''}`} style={{ '--k': CATS[c].color }} onClick={() => setCat(c)} aria-pressed={cat === c}>
                <i />{c} <small>{counts[c]}</small>
              </button>
            ))}
          </div>
        </div>
      </header>

      {lead && (
        <Link to={`/News?a=${lead.id}`} className="nw-glass nn-lead" style={{ '--k': catOf(lead).color }}>
          <Art a={lead} />
          <div className="nn-lead-text">
            <Meta a={lead} />
            <h2>{lead.title}</h2>
            <p>{preview(lead.body)}</p>
            <span className="nn-more">Read the story<ArrowRight /></span>
          </div>
        </Link>
      )}

      {rest.length > 0 && (
        <section className="nn-grid" aria-label="Stories">
          {rest.map((a) => (
            <Link key={a.id} to={`/News?a=${a.id}`} className="nw-glass nn-card" style={{ '--k': catOf(a).color }}>
              <Art a={a} />
              <div className="nn-card-text">
                <Meta a={a} />
                <h3>{a.title}</h3>
                <p>{preview(a.body)}</p>
                <span className="nn-more">Read<ArrowRight /></span>
              </div>
            </Link>
          ))}
        </section>
      )}

      {shown.length === 0 && (
        <section className="nw-glass">
          <div className="nw-empty">
            <Search />
            <b>{articles.length ? 'No stories match' : 'No stories yet'}</b>
            <p>{articles.length ? 'Try another word, or look through every category.' : 'Stories appear here as soon as they are published.'}</p>
            {articles.length > 0 && <button type="button" className="nw-btn" onClick={() => { setQ(''); setCat('All'); }}>Show every story</button>}
          </div>
        </section>
      )}

      <NewsletterCta />
    </>
  );
}

function ShareButton({ a }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${window.location.origin}/News?a=${a.id}`;
    /* the phone's own share sheet; on a computer, the link is copied */
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: a.title, url }); } catch { /* closed */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  };
  return <button type="button" className="nw-btn is-quiet" onClick={share}>{copied ? <><Check />Link copied</> : <><Share2 />Share</>}</button>;
}

function Story({ a, articles }) {
  const i = articles.indexOf(a);
  const newer = articles[i - 1], older = articles[i + 1];
  const sections = useMemo(() => parseArticle(a.body).filter((b) => b.kind === 'h'), [a.body]);
  const toc = sections.length >= 3;
  const jump = (e, id) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  return (
    <>
      <div className={`nn-read${toc ? '' : ' no-toc'}`}>
        <article className="nw-glass nn-article">
          <div className="nn-article-top">
            <Link to="/News" className="nw-btn is-quiet"><ArrowLeft />All stories</Link>
            <span style={{ flex: 1 }} />
            <ShareButton a={a} />
          </div>
          <Meta a={a} />
          <h1>{a.title}</h1>
          {a.image_url && <div className="nn-hero-img"><img src={a.image_url} alt="" onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }} /></div>}
          <ArticleBody text={a.body} />
          {a.link_url && (
            <a className="nw-btn is-primary nn-link" href={a.link_url} target="_blank" rel="noopener noreferrer">{a.link_label || 'Read more'}<ExternalLink /></a>
          )}
        </article>
        {toc && (
          <aside className="nw-glass nn-toc" aria-label="In this story">
            <b><ListTree />In this story</b>
            {sections.map((s) => <a key={s.id} href={`#${s.id}`} onClick={(e) => jump(e, s.id)}>{s.text}</a>)}
          </aside>
        )}
      </div>
      {(older || newer) && (
        <nav className="nn-pn" aria-label="More stories">
          {older && <Link to={`/News?a=${older.id}`} className="nw-glass"><small><ArrowLeft />Older story</small><b>{older.title}</b></Link>}
          {newer && <Link to={`/News?a=${newer.id}`} className="nw-glass next"><small>Newer story<ArrowRight /></small><b>{newer.title}</b></Link>}
        </nav>
      )}
      <NewsletterCta />
    </>
  );
}

export default function News() {
  const [params] = useSearchParams();
  const openId = params.get('a');
  const { data: articles, isLoading, isError } = useQuery({
    queryKey: ['news-articles'],
    queryFn: async () => {
      const all = await base44.entities.NewsArticle.list('-published_at');
      return (all || []).filter((a) => a.published && a.title)
        .sort((x, y) => (Date.parse(y.published_at) || 0) - (Date.parse(x.published_at) || 0));
    },
  });
  const open = openId && articles ? articles.find((a) => a.id === openId) : null;

  useEffect(() => { window.scrollTo(0, 0); }, [openId]);

  return (
    <NewsShell title={open ? open.title : 'News'} css={CSS}>
      {isLoading && (
        <>
          <div className="nw-skel" style={{ height: 230, borderRadius: 24 }} />
          <div className="nw-skel" style={{ height: 300, borderRadius: 24 }} />
        </>
      )}
      {isError && <div className="nw-error">The stories could not be loaded. Please try again in a moment.</div>}
      {articles && openId && !open && (
        <section className="nw-glass">
          <div className="nw-empty">
            <Newspaper />
            <b>This story is not available</b>
            <p>It may have been taken down, or the link is not quite right.</p>
            <Link to="/News" className="nw-btn"><ArrowLeft />All stories</Link>
          </div>
        </section>
      )}
      {articles && open && <Story key={open.id} a={open} articles={articles} />}
      {articles && !openId && <StoryList articles={articles} />}
    </NewsShell>
  );
}
