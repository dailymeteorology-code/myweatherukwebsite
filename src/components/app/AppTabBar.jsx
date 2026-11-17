/* The app's tab bar (17 Nov 2026, at the user's request: "build it like an apple app", in "that liquid glass theme
   like on apple"): Home, Model Data, TCM, Warnings, Settings and More, where everything else lives. It replaces
   components/BottomTabBar.jsx (Home, News, Admin). Phones only, like that bar; the look is in app-tabbar.css.

   As in an iOS app, each tab keeps your place: going back to a tab opens the page you last had open in it, and
   tapping the tab you are on goes to its first page, or to the top of it when you are already there. */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { House, Layers, Zap, TriangleAlert, Settings, Ellipsis } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import './app-tabbar.css';

/* Every page belongs to one tab: the first whose test it passes, so More takes everything the others don't. */
export const APP_TABS = [
  { id: 'home', name: 'Home', icon: House, path: '/', match: (p) => p === '/' || p === '/Home' || p.startsWith('/LocationWeather') },
  { id: 'model', name: 'Model Data', icon: Layers, path: '/ModelData', match: (p) => p.startsWith('/ModelData') },
  { id: 'tcm', name: 'TCM', icon: Zap, path: '/TCMOutlooks', match: (p) => /^\/TCM/.test(p) },
  { id: 'warnings', name: 'Warnings', icon: TriangleAlert, path: '/Warnings', match: (p) => p.startsWith('/Warnings') },
  { id: 'settings', name: 'Settings', icon: Settings, path: '/Settings', match: (p) => p.startsWith('/Settings') },
  { id: 'more', name: 'More', icon: Ellipsis, path: '/More', match: () => true },
];
export const tabOf = (pathname) => APP_TABS.find((t) => t.match(pathname)) || APP_TABS[APP_TABS.length - 1];

const STACK_KEY = 'mwuk-tab-stack';
const readStack = () => { try { return JSON.parse(sessionStorage.getItem(STACK_KEY) || '{}') || {}; } catch { return {}; } };

export default function AppTabBar() {
  const location = useLocation();
  const { isDark } = useTheme();
  const here = location.pathname;
  const active = tabOf(here);
  const index = APP_TABS.indexOf(active);

  /* the page last open in each tab */
  const stack = useRef(readStack());
  useEffect(() => {
    stack.current[active.id] = here + location.search;
    try { sessionStorage.setItem(STACK_KEY, JSON.stringify(stack.current)); } catch { /* storage blocked */ }
  }, [active.id, here, location.search]);

  /* the lens stretches a little as it moves to another tab */
  const [moving, setMoving] = useState(false);
  const last = useRef(index);
  useEffect(() => {
    if (last.current === index) return undefined;
    last.current = index;
    setMoving(true);
    const t = setTimeout(() => setMoving(false), 520);
    return () => clearTimeout(t);
  }, [index]);

  return createPortal(
    <nav className={`atb${isDark ? '' : ' is-light'}`} aria-label="Sections" style={{ '--atb-n': APP_TABS.length, '--atb-i': index }}>
      <span className={`atb-lens${moving ? ' is-moving' : ''}`} aria-hidden="true" />
      {APP_TABS.map((tab) => {
        const Icon = tab.icon;
        const on = tab === active;
        const remembered = stack.current[tab.id];
        const to = on ? tab.path : (remembered || tab.path);
        return (
          <Link
            key={tab.id}
            to={to}
            className="atb-item"
            aria-current={on ? 'page' : undefined}
            onClick={() => {
              /* the tab you are on: back to its first page, or to the top when already there */
              if (on && here === tab.path) window.scrollTo({ top: 0, behavior: 'smooth' });
            }}>
            <Icon aria-hidden="true" />
            <span>{tab.name}</span>
          </Link>
        );
      })}
    </nav>,
    document.body,
  );
}
