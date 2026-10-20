import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { Home, Image, ShieldAlert, Newspaper } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useTheme } from '@/components/ThemeContext';

const TABS = [
  { name: 'Home',     icon: Home,           path: '/',              match: ['/'] },
  { name: 'News',     icon: Newspaper,      path: '/News',          match: ['/News'] },
  { name: 'Graphics', icon: Image,          path: '/Graphics',      match: ['/Graphics'], requiresAuth: false },
  { name: 'Admin',    icon: ShieldAlert,    path: '/AdminSettings', match: ['/AdminSettings'], adminOnly: true },
];

export default function BottomTabBar() {
  const location = useLocation();
  const { isDark } = useTheme();
  const [userRole, setUserRole] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Navigation stack preservation: remember the last path visited inside each tab section.
  // e.g. clicking TCM after viewing /TCMArchive returns the user to /TCMArchive.
  const stackRef = useRef(() => {
    try { return JSON.parse(sessionStorage.getItem('tabStack') || '{}'); } catch { return {}; }
  });
  // Initialise once
  if (typeof stackRef.current === 'function') stackRef.current = stackRef.current();

  useEffect(() => {
    base44.auth.me()
      .then((user) => { setUserRole(user?.role); setIsAuthenticated(true); })
      .catch(() => { setIsAuthenticated(false); });
  }, []);

  // Update the stack whenever the route changes — store the deepest path per tab root.
  useEffect(() => {
    const tab = TABS.find(t => t.match.some(m => location.pathname === m || location.pathname.startsWith(m + '/')));
    if (tab) {
      stackRef.current[tab.name] = location.pathname + location.search;
      try { sessionStorage.setItem('tabStack', JSON.stringify(stackRef.current)); } catch {}
    }
  }, [location.pathname, location.search]);

  const visibleTabs = TABS.filter((tab) => {
    if (tab.adminOnly && (!isAuthenticated || userRole !== 'admin')) return false;
    if (tab.requiresAuth && !isAuthenticated) return false;
    return true;
  });

  const isActive = (tab) =>
    tab.match.some(m => location.pathname === m || location.pathname.startsWith(m + '/'));

  // Portalled to <body> so it escapes the page-transition wrapper (which applies
  // a filter/transform and would otherwise trap this fixed bar at the bottom of
  // the PAGE instead of pinning it to the bottom of the SCREEN).
  return createPortal(
    <nav
      className={`md:hidden fixed bottom-0 left-0 right-0 z-50 border-t ${
        isDark ? 'bg-slate-900/95 border-slate-700' : 'bg-white/95 border-slate-200'
      } backdrop-blur-lg`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-stretch">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab);
          // Use the stored deep-link for this tab if present, otherwise its root
          const to = stackRef.current[tab.name] || tab.path;
          return (
            <Link
              key={tab.name}
              to={active ? tab.path : to}
              className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold transition-colors ${
                active
                  ? (isDark ? 'text-sky-400' : 'text-sky-600')
                  : (isDark ? 'text-slate-400 active:text-slate-200' : 'text-slate-500 active:text-slate-800')
              }`}
              aria-current={active ? 'page' : undefined}
            >
              {active && (
                <span
                  className={`absolute top-0 left-1/2 -translate-x-1/2 h-[3px] w-9 rounded-b-full ${isDark ? 'bg-sky-400' : 'bg-sky-600'}`}
                  style={{ boxShadow: isDark ? '0 0 10px rgba(56,189,248,0.5)' : '0 0 8px rgba(2,132,199,0.35)' }}
                />
              )}
              <Icon className={`w-5 h-5 transition-transform ${active ? 'scale-110' : ''}`} />
              <span>{tab.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>,
    document.body
  );
}