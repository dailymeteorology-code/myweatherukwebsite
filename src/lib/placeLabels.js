/* Place-name labels for the warning maps.
 *
 * Density follows the zoom: zoomed out you see only the major cities; each step in adds
 * the next tier (large towns, towns, then every place over 15,000 people). Labels that
 * would overlap are dropped, bigger places first, so the map never turns into a pile of
 * text. Data: public/data/uk-places.json (GeoNames, CC BY 4.0), UK & Ireland.
 */
let placesPromise = null;
function loadPlaces() {
  if (!placesPromise) {
    placesPromise = fetch('/data/uk-places.json').then((r) => r.json()).then((d) => d.places).catch(() => []);
  }
  return placesPromise;
}

const TIER_FOR_ZOOM = (z) => (z <= 5 ? 1 : z <= 6 ? 2 : z <= 7 ? 3 : 4);
const FONT = { 1: [13, 800], 2: [11.5, 700], 3: [10.5, 600], 4: [9.5, 600] };

const KEY = 'mwuk_warning_place_labels';
export const readPlaceLabelsOn = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };
export const writePlaceLabelsOn = (on) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* storage blocked */ } };

/** Attach to a Leaflet map. Returns { setVisible(bool), setFilter(fn|null), remove() }.
 *  `filter(lat, lon)` limits labels to places it accepts — the warning maps pass
 *  "inside a warning area", so the names shown are the places being warned. */
export function attachPlaceLabels(L, map, { dark = true, visible = true, extraTiers = 0, filter = null } = {}) {
  const layer = L.layerGroup();
  let on = visible;
  let accept = filter;
  let places = [];
  const ink = dark ? '#f1f5f9' : '#0f172a';
  const halo = dark ? 'rgba(2,6,23,0.92)' : 'rgba(255,255,255,0.95)';

  const draw = () => {
    layer.clearLayers();
    if (!on || !places.length) return;
    const maxTier = Math.min(4, TIER_FOR_ZOOM(map.getZoom()) + extraTiers);   // fixed-zoom maps show one tier more
    const bounds = map.getBounds().pad(0.05);
    const placed = [];
    for (const [name, lat, lon, tier] of places) {          // file is ordered biggest first
      if (tier > maxTier || !bounds.contains([lat, lon])) continue;
      if (accept && !accept(lat, lon)) continue;
      const [fs, fw] = FONT[tier];
      const p = map.latLngToContainerPoint([lat, lon]);
      const w = name.length * fs * 0.58 + 12, h = fs + 6;
      const box = [p.x - 4, p.y - h / 2, p.x + w, p.y + h / 2];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      L.marker([lat, lon], {
        interactive: false, keyboard: false,
        icon: L.divIcon({
          className: '',
          iconSize: [0, 0],
          html: `<div style="display:flex;align-items:center;gap:4px;transform:translateY(-50%);white-space:nowrap;pointer-events:none;">`
            + `<span style="width:${tier === 1 ? 6 : 4}px;height:${tier === 1 ? 6 : 4}px;border-radius:9px;background:${ink};box-shadow:0 0 0 1.5px ${halo};flex:none"></span>`
            + `<span style="font:${fw} ${fs}px Inter,system-ui,sans-serif;color:${ink};text-shadow:0 0 3px ${halo},0 0 3px ${halo},0 0 2px ${halo};letter-spacing:0.01em">${name}</span></div>`,
        }),
      }).addTo(layer);
    }
  };

  // Redraw once the view has SETTLED: during a zoom animation Leaflet's bounds and
  // pixel projection are still the old view's, which left labels in a stale box.
  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(draw, 140); };
  const hide = () => layer.clearLayers();

  layer.addTo(map);
  map.on('zoomstart', hide);
  map.on('moveend resize', schedule);
  loadPlaces().then((p) => { places = p; schedule(); });
  return {
    setVisible(v) { on = v; draw(); },
    setFilter(fn) { accept = fn; draw(); },
    remove() { clearTimeout(timer); map.off('zoomstart', hide); map.off('moveend resize', schedule); layer.remove(); },
  };
}
