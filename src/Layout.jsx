import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import AppTabBar from '@/components/app/AppTabBar';
import FirstVisitNotices from '@/components/app/FirstVisitNotices';
import SiteNav from '@/components/nav/SiteNav';
import MobileHeader from '@/components/MobileHeader';
import { useTheme } from '@/components/ThemeContext';




function LayoutContent({ children, currentPageName }) {
  const { isDark } = useTheme();
  const location = useLocation();
  const [userRole, setUserRole] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // AdminSettings runs its own tabbed chrome, so the site nav stays off it.
  const showSiteNav = !location.pathname.startsWith('/AdminSettings');
  /* The iOS-app redesign (17 Nov 2026): the pages built as an app's screens (the home page, the Hub, Warnings,
     More) carry their own large titles, so the phone's website bar stays off them, as an app has none. */
  const path = location.pathname;
  const isHome = path === '/' || path === '/Home';
  const appScreen = isHome || ['/LocationWeather', '/Hub', '/Warnings', '/Radar', '/More'].includes(path);

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
      {!appScreen && <MobileHeader />}
      {showSiteNav && <SiteNav userRole={userRole} isAuthenticated={isAuthenticated} />}
      {/* No pull to refresh (17 Nov 2026, at the user's request): GlobalPullToRefresh wrapped the pages here. */}
        {/* Room for BottomTabBar, which is `md:hidden fixed` — so on desktop
            there is no bar to clear and this padding was 56px of dead space
            below the footer on every page. It was an INLINE style, which beats
            the `md:pb-0` class next to it however the breakpoint resolves, so
            the class never did anything. As a class it can lose to the
            breakpoint the way it was always meant to. */}
        {/* room for the floating tab bar on phones (its height lives in app-tabbar.css) */}
        <div className="pb-[var(--app-tabbar-space)] md:pb-0">
          {children}
        </div>
      <AppTabBar />
      {isHome && <FirstVisitNotices />}
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