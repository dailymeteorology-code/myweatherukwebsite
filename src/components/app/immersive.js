/* A full-screen view in the app (17 Nov 2026, the user: "when you press play the forecast, have the navigation bar
   disappear"): while one is open the tab bar steps down out of sight (app-tabbar.css, html[data-immersive]).
   Counted, so two at once do not bring the bar back when the first closes. */
import { useEffect } from 'react';

let open = 0;
export function useImmersive(on = true) {
  useEffect(() => {
    if (!on) return undefined;
    open += 1;
    document.documentElement.setAttribute('data-immersive', '');
    return () => {
      open = Math.max(0, open - 1);
      if (!open) document.documentElement.removeAttribute('data-immersive');
    };
  }, [on]);
}
