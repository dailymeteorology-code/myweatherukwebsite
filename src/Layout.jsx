import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Image, Menu, X, ShieldAlert, LogIn, LogOut, Sun, Moon, Newspaper, Settings as SettingsIcon, Mail, BarChart3, MapPin, Database } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import BottomTabBar from '@/components/BottomTabBar';
import SiteNav from '@/components/nav/SiteNav';
import MobileHeader from '@/components/MobileHeader';
import GlobalPullToRefresh from '@/components/GlobalPullToRefresh';
import { AnimatePresence, motion } from 'framer-motion';
import { useTheme } from '@/components/ThemeContext';

function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme}
      className={`p-2 rounded-lg transition ${isDark ? 'bg-slate-800 text-yellow-400 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

/* Order carries the grouping — there are no headings, so the public weather
   surfaces come first, then editorial and sign-up, then Settings, then the
   admin-only entries. Location Weather sits with Home as a primary forecast
   view rather than down among the account items. */
const NAV_ITEM_DEFS = [
  { key: 'home',          icon: Home,         path: '/' },
  { key: 'locationWeather', icon: MapPin,     path: '/LocationWeather' },
  { key: 'news',          icon: Newspaper,    path: '/News' },
  { key: 'modelData',     icon: Database,     path: '/ModelData', label: 'Model Data' },
  { key: 'graphics',      icon: Image,        path: '/Graphics', betaOnly: true },
  { key: 'newsletter',    icon: Mail,         path: '/NewsletterSignup' },
  { key: 'settings',      icon: SettingsIcon, path: '/Settings' }, // always visible
  { key: 'modelFeedback', icon: BarChart3,    path: '/ModelFeedback', adminOnly: true },
  { key: 'admin',         icon: ShieldAlert,  path: '/AdminSettings', adminOnly: true },
];

function HamburgerMenu({ userRole, isAuthenticated, isDark }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { t } = useLanguage();
  const isAdmin = userRole === 'admin';
  const isBetaOrAdmin = userRole === 'beta_tester' || isAdmin;

  // Hide the Settings link while on admin pages — Settings is a user-facing
  // accessibility page, shown on every public page instead.
  const onAdminPage = location.pathname.startsWith('/AdminSettings');

  // `label` is the fallback for entries with no translation entry yet, so a new
  // tab reads properly instead of showing its raw key.
  const NAV_ITEMS = NAV_ITEM_DEFS.map(d => ({ ...d, name: d.label ?? t(d.key) }));
  const visibleItems = NAV_ITEMS.filter(item => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.betaOnly && !isBetaOrAdmin) return false;
    if (item.authOnly && !isAuthenticated) return false;
    // Settings is always shown to everyone (logged in or out, any role)
    return true;
  });

  const isActive = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <>
      <button onClick={() => setOpen((o) => !o)}
        className={`p-2 rounded-lg ${isDark ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-100'}`}>
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      <AnimatePresence>
        {open && <>
          <motion.div onClick={() => setOpen(false)}
            className="fixed inset-0 bg-black/50 z-40"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />

          <motion.div
            initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed left-0 top-0 h-screen w-64 z-50 flex flex-col"
            style={{ background: isDark ? '#0b1220' : '#fff', borderRight: isDark ? '1px solid rgba(255,255,255,0.07)' : '1px solid #e2e8f0' }}>

            {/* Header */}
            <div style={{ padding: '20px 20px 16px', borderBottom: isDark ? '1px solid rgba(255,255,255,0.07)' : '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: isDark ? '#38bdf8' : '#0284c7' }}>
                MyWeatherUK
              </span>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isDark ? '#64748b' : '#94a3b8', padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            {/* Nav links */}
            <div style={{ flex: 1, padding: '12px', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <Link key={item.path} to={item.path} onClick={() => setOpen(false)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '11px 14px', borderRadius: 10, textDecoration: 'none',
                      fontSize: 14, fontWeight: active ? 700 : 500,
                      background: active ? (isDark ? 'rgba(56,189,248,0.1)' : 'rgba(2,132,199,0.08)') : 'transparent',
                      color: active ? (isDark ? '#38bdf8' : '#0284c7') : (isDark ? '#94a3b8' : '#475569'),
                      borderLeft: `3px solid ${active ? (isDark ? '#38bdf8' : '#0284c7') : 'transparent'}`,
                    }}>
                    <Icon size={17} />
                    {item.name}
                  </Link>
                );
              })}
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 16px 24px', borderTop: isDark ? '1px solid rgba(255,255,255,0.07)' : '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <ThemeToggle />
              {isAuthenticated
                ? <button onClick={async () => { const { base44 } = await import('@/api/base44Client'); base44.auth.logout('/'); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: isDark ? '#94a3b8' : '#64748b', fontWeight: 600 }}>
                    <LogOut size={15} /> {t('logout')}
                  </button>
                : <button onClick={async () => { const { base44 } = await import('@/api/base44Client'); base44.auth.redirectToLogin(); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: isDark ? '#94a3b8' : '#64748b', fontWeight: 600 }}>
                    <LogIn size={15} /> {t('login')}
                  </button>
              }
            </div>
          </motion.div>
        </>}
      </AnimatePresence>
    </>
  );
}

function LayoutContent({ children, currentPageName }) {
  const { isDark } = useTheme();
  const location = useLocation();
  const [userRole, setUserRole] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // AdminSettings runs its own tabbed chrome, so the site nav stays off it.
  const showSiteNav = !location.pathname.startsWith('/AdminSettings');

  useEffect(() => {
    (async () => {
      try {
        const { base44 } = await import('@/api/base44Client');
        const user = await base44.auth.me();
        setUserRole(user?.role);
        setIsAuthenticated(true);
      } catch {
        setIsAuthenticated(false);
      }
    })();
  }, []);

  return (
    <div className={isDark ? 'bg-slate-900 min-h-screen' : 'bg-slate-50 min-h-screen'}
      style={{ paddingLeft: 'env(safe-area-inset-left, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)' }}>
      <MobileHeader />
      {showSiteNav && <SiteNav userRole={userRole} isAuthenticated={isAuthenticated} />}
      <GlobalPullToRefresh>
        {/* Room for BottomTabBar, which is `md:hidden fixed` — so on desktop
            there is no bar to clear and this padding was 56px of dead space
            below the footer on every page. It was an INLINE style, which beats
            the `md:pb-0` class next to it however the breakpoint resolves, so
            the class never did anything. As a class it can lose to the
            breakpoint the way it was always meant to. */}
        <div className="pb-[calc(56px+env(safe-area-inset-bottom,0px))] md:pb-0">
          {children}
        </div>
      </GlobalPullToRefresh>
      <BottomTabBar />
    </div>
  );
}

export default function Layout({ children, currentPageName }) {
  return (
    <LayoutContent currentPageName={currentPageName}>
      {children}
    </LayoutContent>
  );
}