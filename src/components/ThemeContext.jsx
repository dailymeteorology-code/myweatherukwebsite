import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(() => {
    try {
      const saved = localStorage.getItem('theme');
      // Accept both the current boolean format ("true"/"false") and the legacy
      // Layout format ("dark"/"light") so returning visitors migrate seamlessly
      // now that this is the single source of truth for the theme.
      if (saved === 'true'  || saved === 'dark')  return true;
      if (saved === 'false' || saved === 'light') return false;
      return true; // Default to dark mode when nothing is saved
    } catch {
      return true;
    }
  });

  useEffect(() => {
    localStorage.setItem('theme', JSON.stringify(isDark));
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  // Listen for iOS/system color-scheme changes so the app theme flips
  // instantly when the user switches their device theme — but only while
  // they haven't manually chosen a theme in-app (no saved preference).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => {
      if (localStorage.getItem('theme') === null) {
        setIsDark(e.matches);
      }
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  const toggleTheme = () => setIsDark(prev => !prev);

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