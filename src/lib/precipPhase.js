/**
 * WHAT FORM THE PRECIPITATION IS TAKING
 *
 * The radar tile tells us where the echo is, how strong it is, and — because
 * RainViewer draws snow from a second half of its palette — whether their model
 * called it snow. It cannot tell us the difference between snow, sleet and
 * freezing rain, because reflectivity does not carry that.
 *
 * So the phase comes from a thermal field: surface wet-bulb temperature and the
 * height of the freezing level, on a coarse grid the server keeps warm
 * (`/api/radar/phase`, see server/radarPhase.js for why those two variables and
 * not the thermometer reading). This module fetches it, samples it at a point,
 * and turns a sample into one of four phases.
 *
 * If the field is unavailable the radar still draws: every echo falls back to
 * RainViewer's own rain/snow split. Nothing here is allowed to stop the map.
 */
import { PHASE } from '@/lib/radarPalette';

const ENDPOINT = '/api/radar/phase';
const REFRESH_MS = 10 * 60 * 1000;

let field = null;
let fetchedAt = 0;
let inFlight = null;

/** The cached field, refetched when stale. Resolves to null if unavailable. */
export function loadPhaseField() {
  const now = Date.now();
  if (field && now - fetchedAt < REFRESH_MS) return Promise.resolve(field);
  if (inFlight) return inFlight;

  inFlight = fetch(ENDPOINT, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => {
      if (body && Array.isArray(body.tw)) { field = body; fetchedAt = Date.now(); }
      return field;
    })
    .catch(() => field)
    .finally(() => { inFlight = null; });

  return inFlight;
}

/** The field as last fetched, without waiting. */
export const phaseField = () => field;

/**
 * Bilinear sample of the thermal field. Returns { tw, fzl } in °C and metres,
 * or nulls outside the grid.
 */
export function sampleField(f, lat, lon) {
  if (!f) return { tw: null, fzl: null };
  const x = (lon - f.lon_min) / f.lon_step;
  const y = (lat - f.lat_min) / f.lat_step;
  if (x < 0 || y < 0 || x > f.cols - 1 || y > f.rows - 1) return { tw: null, fzl: null };

  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const x1 = Math.min(f.cols - 1, x0 + 1); const y1 = Math.min(f.rows - 1, y0 + 1);
  const fx = x - x0; const fy = y - y0;

  const at = (arr, i, j) => arr[j * f.cols + i];
  const mix = (arr) => {
    const a = at(arr, x0, y0); const b = at(arr, x1, y0);
    const c = at(arr, x0, y1); const d = at(arr, x1, y1);
    // A hole in the grid should not drag its neighbours towards zero.
    if (a == null || b == null || c == null || d == null) {
      const vals = [a, b, c, d].filter((v) => v != null);
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    }
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };

  const tw = mix(f.tw);
  const fzl = mix(f.fzl);
  return { tw: tw == null ? null : tw / 10, fzl: fzl == null ? null : fzl * 10 };
}

/* ── The decision ────────────────────────────────────────────────────────────
 * Thresholds are wet-bulb, in °C, and follow the numbers UK forecasters use:
 * snow reaches the surface reliably below about 0.5 °C wet-bulb, turns to a
 * mix through roughly 1.5 °C, and is rain above about 2 °C. The freezing level
 * separates the two ways a sub-zero surface can produce liquid drops: no warm
 * layer aloft means snow; a warm layer aloft means the flakes melt and then
 * refreeze on contact, which is freezing rain.
 *
 * RainViewer's own snow flag is taken seriously — it is a model decision made
 * with more than a surface temperature — and only overridden where the thermal
 * field disagrees clearly rather than marginally.
 */
export function classify(tw, fzl, radarSnow) {
  if (tw == null) return radarSnow ? PHASE.SNOW : PHASE.RAIN;

  if (radarSnow) {
    if (tw >= 2.0) return PHASE.RAIN;          // it is not reaching the ground as snow
    if (tw >= 0.5) return PHASE.MIX;
    return PHASE.SNOW;
  }

  const warmAloft = fzl != null && fzl >= 250;
  if (tw <= -0.2 && warmAloft) return PHASE.ICE;
  if (tw <= 0.4) return warmAloft ? PHASE.MIX : PHASE.SNOW;
  if (tw <= 1.6) return PHASE.MIX;
  return PHASE.RAIN;
}

/** Convenience: phase at a point, straight from the cached field. */
export function phaseAt(lat, lon, radarSnow) {
  const { tw, fzl } = sampleField(field, lat, lon);
  return classify(tw, fzl, radarSnow);
}
