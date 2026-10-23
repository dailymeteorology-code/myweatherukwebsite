/* Light or dark, from the visitor's theme preference (lib/preferences): 'light', 'dark', or
   'system', which follows the device and changes with it. The site's own toggle sets light or
   dark explicitly. The `dark` class on <html> drives the Tailwind dark styles. */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { usePreferences } from '@/lib/preferences';

const ThemeContext = createContext();
const systemDark = () => { try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return true; } };

export function ThemeProvider({ children }) {
  const { prefs, setPref } = usePreferences();
  const [deviceDark, setDeviceDark] = useState(systemDark);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setDeviceDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const isDark = prefs.theme === 'system' ? deviceDark : prefs.theme === 'dark';
  useEffect(() => { document.documentElement.classList.toggle('dark', isDark); }, [isDark]);

  const toggleTheme = () => setPref('theme', isDark ? 'light' : 'dark');

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
