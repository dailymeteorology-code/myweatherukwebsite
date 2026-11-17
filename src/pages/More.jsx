/* More, the app's last tab (17 Nov 2026, the iOS-app redesign: "a more button where the person will be able to
   access everything else"): every page that is not a tab of its own, as an iOS grouped list. The pages and what
   each says about itself come from the site menu (components/nav/SiteNav.jsx), so the two never drift apart. */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useTheme } from '@/components/ThemeContext';
import { GROUPS, ACCOUNT_ITEMS } from '@/components/nav/SiteNav';
import { APP_TABS } from '@/components/app/AppTabBar';
import LargeTitle from '@/components/app/LargeTitle';

/* the pages the tab bar already has */
const ON_TABS = new Set(['/', '/LocationWeather', ...APP_TABS.filter((t) => t.id !== 'more').map((t) => t.path)]);
/* each row's tile colour, as iOS colours its Settings rows */
const TILE = {
  '/Hub': '#0a84ff', '/Lightning': '#ff9f0a', '/TCMFrost': '#40c8e0', '/WeatherPatterns': '#5e5ce6', '/WeatherScenarios': '#30d158',
  '/MyWeatherArchive': '#bf5af2', '/GraphicStudio': '#ff375f', '/ForecastVerification': '#32ade6', '/TCMVerification': '#ff9f0a',
  '/TCMArchive': '#8e8e93', '/News': '#ff453a', '/NewsletterSignup': '#0a84ff', '/Subscription': '#30d158', '/AdminSettings': '#636366',
};
const GROUP_TITLES = { forecast: 'Weather', graphics: 'Graphics', verification: 'Verification', news: 'News', account: 'Account' };

export default function More() {
  const { isDark } = useTheme();
  const [role, setRole] = useState(null);
  useEffect(() => { base44.auth.me().then((u) => setRole(u?.role || null)).catch(() => setRole(null)); }, []);
  const isAdmin = role === 'admin';
  const show = (item) => !ON_TABS.has(item.path) && (!item.adminOnly || isAdmin) && (!item.betaOnly || isAdmin);
  const sections = [...GROUPS, { id: 'account', label: 'Account', items: ACCOUNT_ITEMS }]
    .map((g) => ({ ...g, items: g.items.filter(show) }))
    .filter((g) => g.items.length);

  const c = isDark
    ? { bg: '#000000', cell: '#1c1c1e', press: '#2c2c2e', label: '#ffffff', sub: 'rgba(235,235,245,0.6)', sep: 'rgba(84,84,88,0.6)', chev: 'rgba(235,235,245,0.3)' }
    : { bg: '#f2f2f7', cell: '#ffffff', press: '#e5e5ea', label: '#000000', sub: 'rgba(60,60,67,0.6)', sep: 'rgba(60,60,67,0.22)', chev: 'rgba(60,60,67,0.3)' };

  return (
    <div style={{ minHeight: '100vh', background: c.bg, color: c.label, fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif' }}>
      <style>{`.more-row:active { background: ${c.press} !important; } .more-row:focus-visible { outline: 2px solid #0a84ff; outline-offset: -2px; }`}</style>
      <LargeTitle title="More" maxWidth={720} />
      <div className="mx-auto w-full px-4 sm:px-6" style={{ maxWidth: 720, paddingTop: 10, paddingBottom: 28 }}>
        {sections.map((g) => (
          <section key={g.id} style={{ marginTop: 22 }} aria-labelledby={`more-${g.id}`}>
            <h2 id={`more-${g.id}`} style={{ margin: '0 0 7px 16px', fontSize: 13, fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase', color: c.sub }}>
              {GROUP_TITLES[g.id] || g.label}
            </h2>
            <div style={{ background: c.cell, borderRadius: 12, overflow: 'hidden' }}>
              {g.items.map((item, i) => {
                const Icon = item.icon;
                return (
                  <Link key={item.path} to={item.path} className="more-row"
                    style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '0 14px 0 16px', minHeight: 60, textDecoration: 'none', color: c.label, background: c.cell, position: 'relative' }}>
                    <span aria-hidden="true" style={{ flex: 'none', width: 30, height: 30, borderRadius: 7, display: 'grid', placeItems: 'center', background: TILE[item.path] || '#8e8e93', color: '#fff' }}>
                      {Icon ? <Icon style={{ width: 18, height: 18 }} strokeWidth={2.1} /> : null}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, padding: '10px 0', borderBottom: i < g.items.length - 1 ? `0.5px solid ${c.sep}` : 'none', display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'stretch' }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 17, lineHeight: 1.25, letterSpacing: '-0.02em' }}>{item.label}</span>
                        {item.blurb && <span style={{ display: 'block', marginTop: 2, fontSize: 13, lineHeight: 1.3, color: c.sub }}>{item.blurb}</span>}
                      </span>
                      <ChevronRight aria-hidden="true" style={{ width: 18, height: 18, color: c.chev, flex: 'none' }} strokeWidth={2.4} />
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
