/* Radar, the app's Radar tab (17 Nov 2026, at the user's request: "add the radar onto the bottom selection thing"):
   the Met Office rain radar over the UK and Ireland for the last three hours, then the UKV's rain for the next few,
   with lightning, filling the screen above the tab bar. The radar is the Hub's (components/location/LocationRadar.jsx). */
import React, { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/components/ThemeContext';
import LocationRadar from '@/components/location/LocationRadar';
import LargeTitle from '@/components/app/LargeTitle';
import '@/components/app/app-screens.css';

export default function Radar() {
  const { isDark } = useTheme();
  /* the screen's height less whatever sits above it (the computer's site bar) and the tab bar */
  const ref = useRef(null);
  const [top, setTop] = useState(0);
  useEffect(() => {
    const measure = () => { if (ref.current) setTop(Math.max(0, Math.round(ref.current.getBoundingClientRect().top + window.scrollY))); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const ink = isDark ? { '--ink-1': '#ffffff', '--ink-2': 'rgba(235,240,250,0.68)' } : { '--ink-1': '#0f172a', '--ink-2': 'rgba(15,23,42,0.62)' };
  return (
    <div ref={ref} className="app-radar"
      style={{ ...ink, height: `calc(100dvh - var(--app-tabbar-space, 56px) - ${top}px)`, background: isDark ? '#05080e' : '#eef2f7' }}>
      <LargeTitle title="Radar" subtitle="Met Office radar for the last 3 hours, then the UKV's rain" />
      <div className="app-radar-body"><LocationRadar scope="uk" light={!isDark} fill /></div>
    </div>
  );
}
