/* The app's tab bar (17 Nov 2026, at the user's request: "build it like an apple app", in "that liquid glass theme
   like on apple"): Home, Model Data, TCM, Warnings, Radar and More, where everything else lives (Settings among it).
   Phones only; the look is in app-tabbar.css.

   The lens under the chosen tab moves as iOS's Liquid Glass one does ("more pronounced ... the official apple one"):
   a tap sends it across with a stretch and a springy settle; pressing lifts it into a bigger, brighter droplet that
   follows your finger along the bar, magnifying the icon under it, and letting go opens that tab. Each tab keeps its
   place: going back to one opens the screen you left there, and tapping the tab you are on goes to its first
   screen, or to the top when you are already there. */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { House, Layers, Zap, TriangleAlert, Radar, Ellipsis } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import './app-tabbar.css';

/* Every page belongs to one tab: the first whose test it passes, so More takes everything the others don't. */
export const APP_TABS = [
  { id: 'home', name: 'Home', icon: House, path: '/', match: (p) => p === '/' || p === '/Home' || p.startsWith('/LocationWeather') },
  { id: 'model', name: 'Model Data', icon: Layers, path: '/ModelData', match: (p) => p.startsWith('/ModelData') },
  { id: 'tcm', name: 'TCM', icon: Zap, path: '/TCMOutlooks', match: (p) => /^\/TCM/.test(p) },
  { id: 'warnings', name: 'Warnings', icon: TriangleAlert, path: '/Warnings', match: (p) => p.startsWith('/Warnings') },
  { id: 'radar', name: 'Radar', icon: Radar, path: '/Radar', match: (p) => p.startsWith('/Radar') },
  { id: 'more', name: 'More', icon: Ellipsis, path: '/More', match: () => true },
];
export const tabOf = (pathname) => APP_TABS.find((t) => t.match(pathname)) || APP_TABS[APP_TABS.length - 1];

const STACK_KEY = 'mwuk-tab-stack';
const readStack = () => { try { return JSON.parse(sessionStorage.getItem(STACK_KEY) || '{}') || {}; } catch { return {}; } };
const PAD = 5;                                    // the bar's inner padding (app-tabbar.css --atb-pad)

export default function AppTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
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
  const destination = (tab) => (tab === active ? tab.path : (stack.current[tab.id] || tab.path));

  /* a move: the lens stretches more the further it goes */
  const [moving, setMoving] = useState(false);
  const [stretch, setStretch] = useState(1.2);
  const last = useRef(index);
  useEffect(() => {
    if (last.current === index) return undefined;
    setStretch(1 + Math.min(0.5, 0.17 * Math.abs(index - last.current)));
    last.current = index;
    setMoving(true);
    const t = setTimeout(() => setMoving(false), 640);
    return () => clearTimeout(t);
  }, [index]);

  /* pressing and sliding: the lens lifts and follows the finger; letting go opens the tab under it */
  const bar = useRef(null);
  const press = useRef(null);                     // { id, x0, dragging }
  const [lift, setLift] = useState(false);
  const [dragX, setDragX] = useState(null);       // the lens's centre in px from the bar's left, while dragging
  const suppress = useRef(false);
  const geometry = () => {
    const r = bar.current.getBoundingClientRect();
    const itemW = (r.width - 2 * PAD) / APP_TABS.length;
    return { r, itemW };
  };
  const tabAt = (centre, itemW) => Math.max(0, Math.min(APP_TABS.length - 1, Math.floor((centre - PAD) / itemW)));
  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    press.current = { id: e.pointerId, x0: e.clientX, dragging: false };
    setLift(true);
  };
  const onPointerMove = (e) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const { r, itemW } = geometry();
    if (!p.dragging && Math.abs(e.clientX - p.x0) > 7) {
      p.dragging = true;
      try { bar.current.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    }
    if (p.dragging) setDragX(Math.max(PAD + itemW / 2, Math.min(r.width - PAD - itemW / 2, e.clientX - r.left)));
  };
  const onPointerUp = (e) => {
    const p = press.current;
    press.current = null;
    setLift(false);
    if (!p || !p.dragging) { setDragX(null); return; }
    const { r, itemW } = geometry();
    const centre = Math.max(PAD + itemW / 2, Math.min(r.width - PAD - itemW / 2, e.clientX - r.left));
    const tab = APP_TABS[tabAt(centre, itemW)];
    setDragX(null);
    suppress.current = true;                      // the click that follows the slide is not a tap
    setTimeout(() => { suppress.current = false; }, 60);
    if (tab !== active) navigate(destination(tab));
  };
  const onPointerCancel = () => { press.current = null; setLift(false); setDragX(null); };

  let under = index;
  let lensStyle;
  if (dragX != null && bar.current) {
    const { itemW } = geometry();
    under = tabAt(dragX, itemW);
    lensStyle = { translate: `${dragX - PAD - itemW / 2}px 0`, transition: 'none' };
  }

  return createPortal(
    <nav
      ref={bar}
      className={`atb${isDark ? '' : ' is-light'}${lift ? ' is-lifted' : ''}${dragX != null ? ' is-dragging' : ''}`}
      aria-label="Sections"
      style={{ '--atb-n': APP_TABS.length, '--atb-i': index, '--atb-stretch': stretch }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
      <span className={`atb-lens${moving ? ' is-moving' : ''}`} style={lensStyle} aria-hidden="true" />
      {APP_TABS.map((tab, i) => {
        const Icon = tab.icon;
        const on = tab === active;
        return (
          <Link
            key={tab.id}
            to={destination(tab)}
            className={`atb-item${i === under && (lift || dragX != null) ? ' is-under' : ''}`}
            aria-current={on ? 'page' : undefined}
            draggable={false}
            onClick={(e) => {
              if (suppress.current) { e.preventDefault(); return; }
              /* the tab you are on: back to its first screen, or to the top when already there */
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
