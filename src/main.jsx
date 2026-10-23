import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { ThemeProvider } from '@/components/ThemeContext'
import { PreferencesProvider } from '@/lib/preferences'
import { LanguageSync } from '@/lib/i18n'

// In dev/preview, tear down any stale service worker BEFORE React mounts.
// A previously-installed service worker can still be CONTROLLING the page and
// cache-serving an old split-React chunk from /node_modules/.vite (a React
// generation-A chunks vs generation-B react-dom split) — that leaves the React
// dispatcher null and crashes ThemeProvider with "Cannot read properties of
// null (reading 'useState')". A SW only controls pages loaded AFTER it
// activated, so a single purge + reload is enough to get a clean (uncontrolled)
// load: the reloaded page renders React against the one current React build
// before any newly-registered SW can take over.
const IS_DEV = import.meta.env?.DEV;
if (IS_DEV && 'serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  const alreadyPurged = sessionStorage.getItem('mw_sw_purged') === '1';
  if (hadController && !alreadyPurged) {
    // Defer render — the reload will bring up a clean, uncontrolled page.
    sessionStorage.setItem('mw_sw_purged', '1');
    Promise.all([
      navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))).catch(() => {}),
      caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))).catch(() => {}),
    ]).catch(() => {}).finally(() => window.location.reload());
  } else {
    // Clean slate already — drop stale caches for the current load and render.
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
    caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {});
    sessionStorage.removeItem('mw_sw_purged');
    renderApp();
  }
} else {
  renderApp();
}

function renderApp() {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <PreferencesProvider>
      <LanguageSync />
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </PreferencesProvider>
  );
}

// Defer Google AdSense so it doesn't block initial boot in the WebView.
// Loads after first paint (or on first interaction, whichever comes first).
function loadAdSense() {
  if (window.__adsenseLoaded) return;
  window.__adsenseLoaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3742681594369125';
  document.head.appendChild(s);
}
if ('requestIdleCallback' in window) {
  requestIdleCallback(loadAdSense, { timeout: 4000 });
} else {
  window.addEventListener('load', () => setTimeout(loadAdSense, 1500));
}