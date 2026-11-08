import React from 'react';
import { useTheme } from '@/components/ThemeContext';

/* The marks of remembrance beside the site's name in the top bar, desktop and phone alike:
     a poppy all through November, every year
     the black ribbon with the Polish flag for Poland's period of mourning, to the end of 11 Nov 2026
   Each turns itself off on UK dates, so nothing needs taking down afterwards. */
const MOURNING_ENDS = '2026-11-11';
const londonDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });   // YYYY-MM-DD

function Poppy({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block' }}>
      <path d="M16.4 22 C17 26 18.2 29 20.6 31.4" fill="none" stroke="#3f8a3c" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M18.3 27.2 C21.8 26.9 24.6 24.9 25.8 21.6 C22 21.7 19.2 23.6 18.3 27.2 Z" fill="#4da146" />
      <ellipse cx="16" cy="7.9" rx="8.9" ry="6.8" fill="#b30f19" />
      <ellipse cx="16" cy="19.3" rx="8.9" ry="6.8" fill="#b30f19" />
      <ellipse cx="9.2" cy="13.6" rx="7.2" ry="8.7" fill="#e01b22" />
      <ellipse cx="22.8" cy="13.6" rx="7.2" ry="8.7" fill="#e01b22" />
      <path d="M4.4 9.8 C6 7.2 9.2 5.9 12 6.6" fill="none" stroke="#f4585a" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M20 6.6 C22.8 5.9 26 7.2 27.6 9.8" fill="none" stroke="#f4585a" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="16" cy="13.6" r="4.3" fill="#3a0a0e" />
      <circle cx="16" cy="13.6" r="3" fill="#0d0d0f" />
    </svg>
  );
}

export default function BannerMarks({ height = 34 }) {
  const { isDark } = useTheme();
  const today = londonDate();
  const poppy = today.slice(5, 7) === '11';
  const ribbon = today <= MOURNING_ENDS;
  if (!poppy && !ribbon) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      {poppy && <span role="img" aria-label="Remembrance poppy" title="Remembrance poppy" style={{ display: 'block', flexShrink: 0 }}><Poppy size={Math.round(height * 0.82)} /></span>}
      {ribbon && (
        <img
          src="/poland-mourning-ribbon.webp"
          alt="Period of mourning in Poland"
          title="Period of mourning in Poland"
          style={{
            height, width: 'auto', display: 'block', flexShrink: 0,
            /* a black ribbon on the dark bar needs a fine light edge to be seen */
            filter: isDark ? 'drop-shadow(0 0 0.6px rgba(255,255,255,0.85)) drop-shadow(0 0 1.2px rgba(255,255,255,0.4))' : 'none',
          }}
        />
      )}
    </span>
  );
}
