/* Shared Leaflet bootstrap.
 *
 * Leaflet is pulled from a CDN rather than bundled: only a handful of screens
 * draw a map, and bundling it would cost every visitor a library most of them
 * never use.
 *
 * Everything goes through one <script>/<link> pair and one in-flight promise,
 * so several maps mounting at once cause a single download rather than one
 * each. A failed load clears the cached promise so a later attempt can retry
 * instead of being stuck with a permanently rejected one.
 */

const CSS_ID = 'leaflet-css-shared';
const JS_ID = 'leaflet-js-shared';
const SRC = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const HREF = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const TIMEOUT_MS = 12000;

let pending = null;

export function ensureLeaflet() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Leaflet needs a browser'));
  }
  if (window.L) return Promise.resolve(window.L);
  if (pending) return pending;

  pending = new Promise((resolve, reject) => {
    let poll = null;
    let timer = null;
    const settle = (fn, arg) => { clearInterval(poll); clearTimeout(timer); fn(arg); };

    if (!document.getElementById(CSS_ID)) {
      const link = document.createElement('link');
      link.id = CSS_ID;
      link.rel = 'stylesheet';
      link.href = HREF;
      document.head.appendChild(link);
    }

    let script = document.getElementById(JS_ID);
    if (!script) {
      script = document.createElement('script');
      script.id = JS_ID;
      script.src = SRC;
      script.async = true;
      document.head.appendChild(script);
    }

    script.addEventListener('load', () => {
      if (window.L) settle(resolve, window.L);
      else settle(reject, new Error('Leaflet loaded but did not register'));
    });
    script.addEventListener('error', () => settle(reject, new Error('Could not load the map library')));

    // The tag may already have been added — and its load event already fired —
    // by an earlier caller or one of the screens with its own loader, in which
    // case the listener above will never run. Poll as the safety net.
    poll = setInterval(() => { if (window.L) settle(resolve, window.L); }, 90);
    timer = setTimeout(() => {
      if (window.L) settle(resolve, window.L);
      else settle(reject, new Error('The map library timed out'));
    }, TIMEOUT_MS);
  });

  // Let a later mount try again rather than inheriting this failure forever.
  pending.catch(() => { pending = null; });
  return pending;
}

export default ensureLeaflet;
