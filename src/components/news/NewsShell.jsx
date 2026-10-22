/* The News section's page: liquid glass in the site's light and dark themes (the admin glass
   colours from adminTheme), a bar with the section's two pages, News and the Newsletter, and the
   building blocks both use (cards, buttons, chips, fields). */
import React, { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { Newspaper, Mail } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import { adTokens, ADMIN_FONT } from '@/components/admin/adminTheme';

const PAGES = [
  { to: '/News', label: 'News', icon: Newspaper },
  { to: '/NewsletterSignup', label: 'Newsletter', icon: Mail },
];

const CSS = `
${adTokens('.nw-root', '.nw-root.is-light')}
.nw-root { position: relative; min-height: 100vh; min-height: 100dvh; background: var(--ad-bg); color: var(--ad-text); font-family: ${ADMIN_FONT};
  -webkit-font-smoothing: antialiased; transition: background .4s ease; overflow-x: clip; padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px)); }
.nw-root *, .nw-root *::before, .nw-root *::after { box-sizing: border-box; }
.nw-root svg { display: inline-block; flex-shrink: 0; }
.nw-ambient { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.nw-ambient i { position: absolute; display: block; border-radius: 50%; }
.nw-ambient i:nth-child(1) { width: 70vw; height: 70vw; top: -26vw; left: -18vw; background: radial-gradient(circle, var(--ad-orb-a), transparent 62%); }
.nw-ambient i:nth-child(2) { width: 60vw; height: 60vw; top: 18vh; right: -24vw; background: radial-gradient(circle, var(--ad-orb-b), transparent 62%); }
.nw-ambient i:nth-child(3) { width: 56vw; height: 56vw; bottom: -24vw; left: 18vw; background: radial-gradient(circle, var(--ad-orb-c), transparent 62%); }
.nw-wrap { position: relative; z-index: 1; width: min(1180px, 100%); margin: 0 auto; padding: clamp(14px, 3vw, 28px) clamp(12px, 2.6vw, 24px) 40px; display: flex; flex-direction: column; gap: 16px; }
.nw-glass { position: relative; background: var(--ad-surface); border: 1px solid var(--ad-border); border-radius: 24px;
  -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%); box-shadow: var(--ad-shadow), inset 0 1px 0 var(--ad-highlight); }
.nw-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.nw-tab { display: inline-flex; align-items: center; gap: 7px; padding: 7px 13px; border-radius: 99px; font-size: 12.5px; font-weight: 700; text-decoration: none;
  color: var(--ad-text-mid); background: var(--ad-surface3); border: 1px solid var(--ad-border); transition: color .15s, background .15s, border-color .15s; }
.nw-tab svg { width: 14px; height: 14px; }
.nw-tab:hover { color: var(--ad-text); border-color: var(--ad-border3); }
.nw-tab.active { color: var(--ad-text); background: color-mix(in srgb, var(--ad-sky) 15%, var(--ad-surface2)); border-color: color-mix(in srgb, var(--ad-sky) 45%, transparent); }
.nw-tab.active svg { color: var(--ad-sky); }
.nw-eyebrow { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--ad-sky); }
.nw-eyebrow svg { width: 13px; height: 13px; }
.nw-h1 { margin: 10px 0 0; font-size: clamp(30px, 5.4vw, 48px); font-weight: 800; letter-spacing: -.035em; line-height: 1.04; }
.nw-h1 span { background: linear-gradient(90deg, var(--ad-sky), var(--ad-violet)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.nw-lede { margin: 12px 0 0; max-width: 660px; font-size: 15px; line-height: 1.6; color: var(--ad-text-mid); }
.nw-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; border-radius: 13px; font: inherit; font-size: 13.5px; font-weight: 700; cursor: pointer;
  text-decoration: none; color: var(--ad-text); background: var(--ad-surface2); border: 1px solid var(--ad-border2); transition: background .15s, border-color .15s, opacity .15s, transform .15s; white-space: nowrap; }
.nw-btn:hover:not(:disabled) { border-color: var(--ad-border3); background: var(--ad-surface); }
.nw-btn:disabled { opacity: .55; cursor: default; }
.nw-btn svg { width: 16px; height: 16px; }
.nw-btn.is-primary { color: #fff; border-color: transparent; background: linear-gradient(135deg, #0ea5e9, #6366f1); box-shadow: 0 10px 24px -12px rgba(14,165,233,.7); }
.nw-btn.is-primary:hover:not(:disabled) { background: linear-gradient(135deg, #38bdf8, #818cf8); }
.nw-btn.is-quiet { background: transparent; border-color: transparent; color: var(--ad-text-mid); padding-left: 8px; padding-right: 8px; }
.nw-btn.is-quiet:hover:not(:disabled) { color: var(--ad-text); background: var(--ad-surface3); border-color: transparent; }
.nw-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 99px; font-size: 10.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; white-space: nowrap;
  color: color-mix(in srgb, var(--k, var(--ad-sky)) 82%, var(--ad-text)); background: color-mix(in srgb, var(--k, var(--ad-sky)) 13%, transparent);
  border: 1px solid color-mix(in srgb, var(--k, var(--ad-sky)) 36%, transparent); }
.nw-meta { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ad-text-dim); white-space: nowrap; }
.nw-meta svg { width: 13px; height: 13px; }
.nw-label { display: block; margin: 0 0 7px; font-size: 11px; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; color: var(--ad-text-dim); }
.nw-input { width: 100%; font: inherit; font-size: 15px; padding: 12px 14px; border-radius: 14px; color: var(--ad-text); background: var(--ad-surface3); border: 1px solid var(--ad-border2); outline: none;
  transition: border-color .15s, box-shadow .15s; }
.nw-input::placeholder { color: var(--ad-text-faint); }
.nw-input:focus { border-color: color-mix(in srgb, var(--ad-sky) 60%, transparent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ad-sky) 16%, transparent); }
.nw-error { padding: 11px 13px; border-radius: 13px; font-size: 13.5px; line-height: 1.45; color: var(--ad-red); background: var(--ad-red-low); border: 1px solid color-mix(in srgb, var(--ad-red) 30%, transparent); }
.nw-skel { border-radius: 18px; background: linear-gradient(90deg, var(--ad-surface3), var(--ad-surface2), var(--ad-surface3)); background-size: 200% 100%; animation: nw-shimmer 1.5s ease-in-out infinite; }
@keyframes nw-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.nw-spin { animation: nw-spin 1s linear infinite; }
@keyframes nw-spin { to { transform: rotate(360deg); } }
.nw-empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 48px 20px; color: var(--ad-text-mid); }
.nw-empty > svg { width: 30px; height: 30px; color: var(--ad-text-faint); }
.nw-empty b { color: var(--ad-text); font-size: 16px; }
.nw-empty p { margin: 0; max-width: 440px; font-size: 13.5px; line-height: 1.55; }
@media (prefers-reduced-motion: reduce) { .nw-root * { transition: none !important; animation: none !important; } }
`;

/** A page of the News section: the section bar, then `children`. `css` adds the page's own rules. */
export default function NewsShell({ title, css = '', children }) {
  const { isDark } = useTheme();
  useEffect(() => { document.title = `${title} · MyWeatherUK`; }, [title]);
  return (
    <div className={`nw-root${isDark ? '' : ' is-light'}`}>
      <style>{CSS + css}</style>
      <div className="nw-ambient" aria-hidden="true"><i /><i /><i /></div>
      <main className="nw-wrap">
        <nav className="nw-tabs" aria-label="News">
          {PAGES.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end className={({ isActive }) => `nw-tab${isActive ? ' active' : ''}`}><Icon />{label}</NavLink>
          ))}
        </nav>
        {children}
      </main>
    </div>
  );
}
