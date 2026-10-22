/* The Verification section's page: liquid glass in the site's light and dark themes (the admin
   glass colours from adminTheme), a header with the section's three pages as tabs, and the
   building blocks the pages share (cards, buttons, chips, stats). */
import React, { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { BarChart3, Target, Archive } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import { adTokens, ADMIN_FONT } from '@/components/admin/adminTheme';

const PAGES = [
  { to: '/ForecastVerification', label: 'Forecast Verification', icon: BarChart3 },
  { to: '/TCMVerification', label: 'TCM Verification', icon: Target },
  { to: '/TCMArchive', label: 'TCM Archive', icon: Archive },
];

const CSS = `
${adTokens('.vf-root', '.vf-root.is-light')}
.vf-root { position: relative; min-height: 100vh; min-height: 100dvh; background: var(--ad-bg); color: var(--ad-text); font-family: ${ADMIN_FONT};
  -webkit-font-smoothing: antialiased; transition: background .4s ease; overflow-x: clip; padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px)); }
.vf-root *, .vf-root *::before, .vf-root *::after { box-sizing: border-box; }
.vf-root svg { display: inline-block; }
.vf-root input[type='datetime-local'] { color-scheme: dark; }
.vf-root.is-light input[type='datetime-local'] { color-scheme: light; }
.vf-root select option { background: var(--ad-bg); color: var(--ad-text); }
.vf-ambient { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.vf-ambient i { position: absolute; display: block; border-radius: 50%; }
.vf-ambient i:nth-child(1) { width: 70vw; height: 70vw; top: -26vw; left: -18vw; background: radial-gradient(circle, var(--ad-orb-a), transparent 62%); }
.vf-ambient i:nth-child(2) { width: 60vw; height: 60vw; top: 18vh; right: -24vw; background: radial-gradient(circle, var(--ad-orb-b), transparent 62%); }
.vf-ambient i:nth-child(3) { width: 56vw; height: 56vw; bottom: -24vw; left: 18vw; background: radial-gradient(circle, var(--ad-orb-c), transparent 62%); }
.vf-wrap { position: relative; z-index: 1; width: min(1440px, 100%); margin: 0 auto; padding: clamp(14px, 3vw, 28px) clamp(10px, 2.4vw, 24px) 40px; display: flex; flex-direction: column; gap: 16px; }
.vf-glass { position: relative; background: var(--ad-surface); border: 1px solid var(--ad-border); border-radius: 24px;
  -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%); box-shadow: var(--ad-shadow), inset 0 1px 0 var(--ad-highlight); }
.vf-hero { padding: clamp(18px, 3vw, 28px); overflow: hidden; }
.vf-hero::before { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background: radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, var(--c) 18%, transparent), transparent 55%), radial-gradient(90% 80% at 100% 0%, color-mix(in srgb, var(--c2) 14%, transparent), transparent 60%); }
.vf-hero > * { position: relative; }
.vf-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 16px; }
.vf-tab { display: inline-flex; align-items: center; gap: 7px; padding: 7px 13px; border-radius: 99px; font-size: 12.5px; font-weight: 700; text-decoration: none;
  color: var(--ad-text-mid); background: var(--ad-surface3); border: 1px solid var(--ad-border); transition: color .15s, background .15s, border-color .15s; }
.vf-tab svg { width: 14px; height: 14px; }
.vf-tab:hover { color: var(--ad-text); border-color: var(--ad-border3); }
.vf-tab.active { color: var(--ad-text); background: color-mix(in srgb, var(--c) 16%, var(--ad-surface2)); border-color: color-mix(in srgb, var(--c) 50%, transparent); }
.vf-tab.active svg { color: var(--c); }
.vf-hero h1 { margin: 0; font-size: clamp(28px, 5vw, 44px); font-weight: 800; letter-spacing: -.035em; line-height: 1.03; }
.vf-hero h1 span { background: linear-gradient(90deg, var(--c), var(--c2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.vf-lede { margin: 10px 0 0; max-width: 760px; font-size: 14.5px; line-height: 1.55; color: var(--ad-text-mid); }
.vf-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 18px; }
.vf-stat { padding: 12px 14px; border-radius: 16px; background: var(--ad-surface3); border: 1px solid var(--ad-border); min-width: 0; }
.vf-stat small { display: block; font-size: 10.5px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; color: var(--ad-text-dim); }
.vf-stat b { display: block; margin-top: 4px; font-size: 21px; font-weight: 800; letter-spacing: -.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vf-stat span { display: block; margin-top: 1px; font-size: 11.5px; color: var(--ad-text-dim); }
.vf-card { overflow: hidden; }
.vf-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 14px 18px; border-bottom: 1px solid var(--ad-border); }
.vf-head > svg { width: 17px; height: 17px; color: var(--c, var(--ad-sky)); flex-shrink: 0; }
.vf-head h2 { margin: 0; font-size: 15px; font-weight: 750; letter-spacing: -.01em; }
.vf-head small { color: var(--ad-text-dim); font-size: 12.5px; }
.vf-head .vf-sp { flex: 1; }
.vf-body { padding: 16px 18px; }
.vf-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 8px 14px; border-radius: 12px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
  color: var(--ad-text); background: var(--ad-surface2); border: 1px solid var(--ad-border2); transition: background .15s, border-color .15s, opacity .15s; white-space: nowrap; }
.vf-btn:hover:not(:disabled) { border-color: var(--ad-border3); background: var(--ad-surface); }
.vf-btn:disabled { opacity: .5; cursor: default; }
.vf-btn svg { width: 15px; height: 15px; }
.vf-btn.is-primary { color: var(--ad-accent-ink); background: var(--c, var(--ad-sky)); border-color: transparent; }
.vf-btn.is-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--c, var(--ad-sky)) 85%, white); }
.vf-btn.is-danger { color: var(--ad-red); border-color: color-mix(in srgb, var(--ad-red) 40%, transparent); background: var(--ad-red-low); }
.vf-btn.is-on { color: var(--ad-text); background: color-mix(in srgb, var(--c, var(--ad-sky)) 16%, var(--ad-surface2)); border-color: color-mix(in srgb, var(--c, var(--ad-sky)) 55%, transparent); }
.vf-btn.is-icon { padding: 8px; }
.vf-seg { display: inline-flex; padding: 3px; border-radius: 13px; background: var(--ad-surface3); border: 1px solid var(--ad-border); gap: 2px; flex-wrap: wrap; }
.vf-seg button { font: inherit; font-size: 12.5px; font-weight: 700; padding: 6px 12px; border-radius: 10px; border: 0; cursor: pointer; color: var(--ad-text-mid); background: transparent; white-space: nowrap; }
.vf-seg button.on { color: var(--ad-text); background: var(--ad-surface2); box-shadow: 0 1px 2px rgba(0,0,0,.18), inset 0 1px 0 var(--ad-highlight); }
.vf-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 99px; font-size: 11px; font-weight: 800; letter-spacing: .04em; white-space: nowrap;
  color: var(--k, var(--ad-text-mid)); background: color-mix(in srgb, var(--k, var(--ad-text-mid)) 14%, transparent); border: 1px solid color-mix(in srgb, var(--k, var(--ad-text-mid)) 38%, transparent); }
.vf-chip svg { width: 12px; height: 12px; }
.vf-label { display: block; font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; color: var(--ad-text-dim); margin: 0 0 6px; }
.vf-input { width: 100%; font: inherit; font-size: 14px; padding: 9px 12px; border-radius: 12px; color: var(--ad-text); background: var(--ad-surface3); border: 1px solid var(--ad-border2); outline: none; }
.vf-input:focus { border-color: color-mix(in srgb, var(--c, var(--ad-sky)) 60%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c, var(--ad-sky)) 18%, transparent); }
textarea.vf-input { resize: vertical; min-height: 70px; line-height: 1.45; }
.vf-mapwrap { position: relative; }
.vf-maphint { position: absolute; inset: 0; z-index: 800; display: grid; place-items: center; pointer-events: none; border-radius: 18px; font-size: 14px; font-weight: 700; color: #fff;
  background: rgba(2,6,15,.45); opacity: 0; transition: opacity .25s; }
.vf-maphint.on { opacity: 1; }
.vf-leaflet { width: 100%; border-radius: 18px; overflow: hidden; background: var(--ad-surface3); isolation: isolate; }
.vf-leaflet .leaflet-control-zoom a { background: var(--ad-surface2); color: var(--ad-text); border-color: var(--ad-border2); backdrop-filter: blur(10px); }
.vf-leaflet .leaflet-control-attribution { background: color-mix(in srgb, var(--ad-bg) 70%, transparent); color: var(--ad-text-dim); font-size: 10px; }
.vf-leaflet .leaflet-control-attribution a { color: var(--ad-text-mid); }
.vf-read { position: absolute; left: 12px; bottom: 12px; z-index: 700; pointer-events: none; padding: 7px 11px; border-radius: 12px; font-size: 12.5px; font-weight: 650;
  background: color-mix(in srgb, var(--ad-bg) 78%, transparent); border: 1px solid var(--ad-border2); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
.vf-busy { position: absolute; right: 12px; top: 12px; z-index: 700; display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 10px; font-size: 12px;
  background: color-mix(in srgb, var(--ad-bg) 78%, transparent); border: 1px solid var(--ad-border2); }
.vf-busy svg { width: 14px; height: 14px; }
.vf-empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 44px 20px; color: var(--ad-text-mid); }
.vf-empty > svg { width: 30px; height: 30px; color: var(--ad-text-faint); }
.vf-empty b { color: var(--ad-text); font-size: 15px; }
.vf-empty p { margin: 0; max-width: 460px; font-size: 13px; line-height: 1.55; }
.vf-note { font-size: 12.5px; line-height: 1.55; color: var(--ad-text-mid); }
.vf-note b { color: var(--ad-text); }
.vf-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 11.5px; color: var(--ad-text-mid); }
.vf-legend i { display: inline-block; width: 12px; height: 12px; border-radius: 4px; margin-right: 5px; vertical-align: -2px; }
.vf-spin { animation: vf-spin 1s linear infinite; }
@keyframes vf-spin { to { transform: rotate(360deg); } }
.vf-skel { border-radius: 16px; background: linear-gradient(90deg, var(--ad-surface3), var(--ad-surface2), var(--ad-surface3)); background-size: 200% 100%; animation: vf-shimmer 1.5s ease-in-out infinite; }
@keyframes vf-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.vf-error { padding: 12px 14px; border-radius: 14px; font-size: 13px; color: var(--ad-red); background: var(--ad-red-low); border: 1px solid color-mix(in srgb, var(--ad-red) 30%, transparent); }
@media (max-width: 640px) {
  .vf-head { padding: 12px 14px; }
  .vf-body { padding: 12px 12px; }
  .vf-stat b { font-size: 18px; }
  .vf-tab { padding: 6px 11px; font-size: 12px; }
}
@media (prefers-reduced-motion: reduce) { .vf-root * { transition: none !important; animation: none !important; } }
`;

/**
 * A Verification page. `hero` goes under the title (stats, controls); `accent` and `accent2`
 * colour the title and the tab of this page.
 */
export default function VfPage({ title, lede, accent, accent2, hero = null, css = '', children }) {
  const { isDark } = useTheme();
  useEffect(() => { document.title = `${title} · MyWeatherUK`; }, [title]);
  return (
    <div className={`vf-root${isDark ? '' : ' is-light'}`} style={{ '--c': accent, '--c2': accent2 }}>
      <style>{CSS + css}</style>
      <div className="vf-ambient" aria-hidden="true"><i /><i /><i /></div>
      <main className="vf-wrap">
        <header className="vf-glass vf-hero">
          <nav className="vf-tabs" aria-label="Verification">
            {PAGES.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `vf-tab${isActive ? ' active' : ''}`}><Icon />{label}</NavLink>
            ))}
          </nav>
          <h1><span>{title}</span></h1>
          {lede && <p className="vf-lede">{lede}</p>}
          {hero}
        </header>
        {children}
      </main>
    </div>
  );
}

export const Stat = ({ label, value, note }) => (
  <div className="vf-stat"><small>{label}</small><b>{value}</b>{note && <span>{note}</span>}</div>
);
