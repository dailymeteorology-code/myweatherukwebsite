/* Add to your home screen (Location Weather, 16 Nov 2026, Phase F).

   While the Location page is open it offers its own web app manifest (public/location.webmanifest:
   "MyWeatherUK", the real logo, opening straight to your place with ?app=1) in place of the site's, and
   registers the small service worker (public/sw.js) that lets the installed app open offline. Both only
   in production builds; in development the site's main.jsx clears service workers on purpose.

   Browsers that can install say so with a "beforeinstallprompt" event, which is kept here for the menu's
   button; on other pages the browser's own offer is left alone. Safari has no such event: the menu
   explains Share, then Add to Home Screen. */
import { useEffect, useState } from 'react';

let deferred = null;
const listeners = new Set();
const tell = () => listeners.forEach((f) => f());
const onLocationPage = () => /^\/locationweather\/?$/i.test(window.location.pathname);

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    if (!onLocationPage()) return;
    e.preventDefault();
    deferred = e;
    tell();
  });
  window.addEventListener('appinstalled', () => { deferred = null; tell(); });
}

export const isStandalone = () => !!(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** { canPrompt, standalone, ios, install() } for the menu. */
export function useInstall() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((x) => x + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return {
    canPrompt: !!deferred,
    standalone: isStandalone(),
    ios: isIOS(),
    install: async () => {
      const e = deferred;
      if (!e) return false;
      deferred = null;
      tell();
      try { await e.prompt(); const r = await e.userChoice; return r?.outcome === 'accepted'; } catch { return false; }
    },
  };
}

/** The Location page's manifest and offline worker, while the page is open. */
export function useLocationApp() {
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    const before = link?.getAttribute('href');
    if (link) link.setAttribute('href', '/location.webmanifest');
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
    }
    return () => { if (link && before) link.setAttribute('href', before); };
  }, []);
}
