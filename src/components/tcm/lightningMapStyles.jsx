/* CSS string for LightningMap, extracted from pages/TCM */
export const LIGHTNING_MAP_CSS = `
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes livePulse  { 0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,0.5)} 50%{box-shadow:0 0 0 6px rgba(34,197,94,0)} }
@keyframes stormPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.1)} }
@keyframes alertSlide { 0%{transform:translateX(120%);opacity:0} 10%{transform:translateX(0);opacity:1} 82%{transform:translateX(0);opacity:1} 100%{transform:translateX(120%);opacity:0} }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes warningPulseIn { 0%{opacity:0;transform:scale(0.9) translateY(10px)} 100%{opacity:1;transform:scale(1) translateY(0)} }

body.tcm-map-fullscreen #tcm-title-block { display: none !important; }
/* Historical lightning panel fullscreen */
body.tcm-hist-fullscreen { overflow: hidden !important; }
.hist-fullscreen-container {
  position: fixed !important;
  inset: 0 !important;
  z-index: 9996 !important;
  overflow: hidden !important;
  display: flex !important;
  flex-direction: column !important;
}
body.tcm-map-fullscreen .tcm-hamburger-btn { display: none !important; }
/* Fullscreen fix: prevent page scroll and side-pan zoom on mobile */
body.tcm-map-fullscreen {
  overflow: hidden !important;
  overscroll-behavior: none !important;
  touch-action: none !important;
  position: fixed !important;
  width: 100% !important;
}
/* Ensure fullscreen map fills truly to safe area edges */
.tcm-fullscreen-container {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  height: 100dvh !important;
  z-index: 9997 !important;
  overflow: hidden !important;
  touch-action: pan-x pan-y !important;
}
/* Prevent the Leaflet map from triggering document-level touch scroll */
.leaflet-container {
  touch-action: none !important;
}
.leaflet-container, .leaflet-tile-pane, .leaflet-map-pane, .leaflet-pane, .leaflet-tile, .leaflet-tile-container, .leaflet-layer { background: #060d1a !important; }
/* Ensure strike dots have no outline — SVG path strokes set to none */
.leaflet-overlay-pane svg path[stroke-width="0"],
.leaflet-overlay-pane svg path[stroke="none"] { stroke: none !important; paint-order: fill; }
/* Canvas renderer: disable anti-alias ring artifact */
.leaflet-canvas-renderer canvas { image-rendering: auto; }
/* The strike-density field is an overlay, so it must stay transparent
   whatever the blanket background rule above says. */
.lx-heat-canvas { background: transparent !important; }
/* Historical archive fullscreen escape */
.hist-fullscreen-portal {
  position: fixed !important;
  inset: 0 !important;
  z-index: 9996 !important;
  overflow: hidden !important;
}
.live-dot-green { width:8px;height:8px;border-radius:50%;background:#22c55e;animation:livePulse 1.8s ease infinite; }
.live-dot-amber { width:8px;height:8px;border-radius:50%;background:#f97316; }
.alert-banner { animation: alertSlide 7s ease forwards; }
.leaflet-control-attribution { background:rgba(6,13,26,0.75)!important;color:rgba(148,163,184,0.45)!important;font-size:9px!important;backdrop-filter:blur(8px);border-radius:6px 0 0 0!important;padding:2px 8px!important; }
.leaflet-control-attribution a { color:rgba(148,163,184,0.55)!important; }
.blitz-popup .leaflet-popup-content-wrapper { background:transparent!important;border:none!important;box-shadow:none!important;padding:0!important; }
.blitz-popup .leaflet-popup-content { margin:0!important; }
.blitz-popup .leaflet-popup-tip-container { display:none!important; }

/* ── Tablet (768px–1024px) ───────────────────────────────────────────────── */
@media (min-width: 769px) and (max-width: 1024px) {
  .tcm-stat-strip     { grid-template-columns: repeat(3, 1fr) !important; }
  .tcm-warning-cards  { grid-template-columns: repeat(2, 1fr) !important; }
  .tcm-map-row1       { flex-wrap: wrap !important; gap: 6px !important; }
}

/* ── Mobile tab bar show on small screens ───────────────────────────────── */
@media (max-width: 768px) {
  .tcm-mobile-tabbar { display: flex !important; }
  #tcm-title-block nav { display: none !important; }
  #tcm-main-content { padding-bottom: 72px !important; }
}

/* ── Mobile (≤768px) ────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .map-risk-legend { 
    position: static !important; 
    max-height: none !important; 
    width: 100% !important; 
    border-radius: 0 0 13px 13px !important;
    margin-top: 0 !important;
  }
  .tcm-map-topbar { padding: 8px 8px !important; gap: 5px !important; }
  .tcm-map-row1   { flex-wrap: wrap !important; gap: 5px !important; }
  .tcm-map-row2   { gap: 4px !important; flex-wrap: wrap !important; }
  .tcm-map-row2 button { padding: 4px 8px !important; font-size: 0.62rem !important; }
  .tcm-view-toggle button { padding: 5px 10px !important; font-size: 0.67rem !important; }
  .tcm-sound-toggles { flex-wrap: wrap !important; }
  .tcm-sound-toggles button { padding: 5px 7px !important; }
  .tcm-warning-cards  { grid-template-columns: 1fr !important; }
  .leaflet-control-zoom { display: none !important; }
}

@media (max-width: 640px) {
  .tcm-hero-header h2 { font-size: 1.15rem !important; }
  .tcm-hero-header p  { font-size: 0.68rem !important; }
  .tcm-stat-strip     { grid-template-columns: repeat(2, 1fr) !important; }
}

/* ── Light mode overrides ───────────────────────────────────────────────── */
.lightning-map-light .leaflet-container,
.lightning-map-light .leaflet-tile-pane,
.lightning-map-light .leaflet-map-pane,
.lightning-map-light .leaflet-pane,
.lightning-map-light .leaflet-tile,
.lightning-map-light .leaflet-tile-container,
.lightning-map-light .leaflet-layer { background: #dbe6f3 !important; }
.lightning-map-light .leaflet-control-attribution { background:rgba(220,230,245,0.85)!important;color:rgba(71,85,105,0.7)!important; }
.lightning-map-light .leaflet-control-attribution a { color:rgba(71,85,105,0.8)!important; }
`;