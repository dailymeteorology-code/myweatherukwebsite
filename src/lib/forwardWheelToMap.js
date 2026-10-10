/**
 * Forward a React wheel event to the underlying Leaflet map container so an
 * SVG overlay sitting on top of the map doesn't swallow scroll-wheel zoom.
 *
 * Usage:
 *   import { fwdWheel } from '@/lib/forwardWheelToMap';
 *   <svg ... onWheelCapture={fwdWheel}>
 */
export function fwdWheel(e) {
  try {
    const svg = e.currentTarget;
    // The Leaflet container is rendered as a sibling/ancestor in TCMLeafletBase.
    // It lives at .leaflet-container within the same wrapper.
    const wrap = svg.parentElement;
    const container = wrap?.querySelector?.('.leaflet-container')
      || svg.closest?.('div')?.querySelector?.('.leaflet-container');
    if (!container) return;
    // Synthesise a real wheel event so Leaflet's scroll-wheel-zoom handler fires.
    const evt = new WheelEvent('wheel', {
      deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
      clientX: e.clientX, clientY: e.clientY,
      bubbles: true, cancelable: true,
    });
    container.dispatchEvent(evt);
    e.preventDefault();
    e.stopPropagation();
  } catch {}
}