/* ════════════════════════════════════════════════════════════════════════════
   TCM V5 — DRAWER AND FULLSCREEN
   ────────────────────────────────────────────────────────────────────────────
   Injected alongside tcmv5-enhance.css. Adds three controls the ported viewer
   does not have: a handle that slides the panel out of the way, a fullscreen
   toggle for the map, and the keyboard shortcuts to match.

   LEAFLET IS TOLD, NOT LEFT TO GUESS. A map whose container changes size
   without being told keeps its old centre and draws tiles for a viewport that
   no longer exists — grey bands down one side, and clicks landing in the wrong
   place. Leaflet already listens for window resize, so dispatching one after
   every size change is enough and needs no handle on the map object. It fires
   after the CSS transition rather than during it: invalidating mid-animation
   measures a width the map is still moving through.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const app = document.getElementById('app');
  const side = document.getElementById('side');
  const mapEl = document.getElementById('map');
  if (!app || !side || !mapEl) return;

  const SETTLE_MS = 300;              // matches the drawer transition
  const STORE = 'tcmv5_side_open';

  const icon = (d) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

  /** Tell Leaflet the canvas moved, once it has finished moving. */
  const settle = () => setTimeout(() => window.dispatchEvent(new Event('resize')), SETTLE_MS);

  /* ── the drawer ─────────────────────────────────────────────────────────── */
  const setOpen = (open, remember = true) => {
    document.body.classList.toggle('tcmx-side-closed', !open);
    handle.setAttribute('aria-expanded', String(open));
    handle.title = open ? 'Hide the panel  (\\)' : 'Show the panel  (\\)';
    if (remember) { try { localStorage.setItem(STORE, open ? '1' : '0'); } catch (e) { /* private mode */ } }
    settle();
  };

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'tcmx-handle';
  handle.setAttribute('aria-controls', 'side');
  handle.innerHTML = icon('<path d="M15 18l-6-6 6-6"/>');
  handle.addEventListener('click', () =>
    setOpen(document.body.classList.contains('tcmx-side-closed')));
  app.appendChild(handle);

  /* Open by default on a wide screen; closed on a narrow one, where the drawer
     covers the map it is describing. A stored choice beats both. */
  let open = window.innerWidth > 720;
  try {
    const saved = localStorage.getItem(STORE);
    if (saved !== null) open = saved === '1';
  } catch (e) { /* private mode */ }
  setOpen(open, false);

  /* ── fullscreen ─────────────────────────────────────────────────────────────
     The whole app goes fullscreen, not just the map element: the drawer and
     these controls are children of it, and a fullscreen #map alone would leave
     them behind on the page underneath. */
  const fsBtn = document.createElement('button');
  fsBtn.type = 'button';
  fsBtn.className = 'tcmx-mapbtn';
  fsBtn.title = 'Fullscreen  (F)';
  fsBtn.setAttribute('aria-label', 'Fullscreen');

  const ENTER = '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>';
  const EXIT = '<path d="M3 8h3a2 2 0 0 0 2-2V3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/>';
  fsBtn.innerHTML = icon(ENTER);

  const inFullscreen = () => document.fullscreenElement === app;
  const toggleFullscreen = () => {
    if (inFullscreen()) document.exitFullscreen?.();
    else app.requestFullscreen?.().catch(() => { /* refused, e.g. no gesture */ });
  };
  fsBtn.addEventListener('click', toggleFullscreen);

  document.addEventListener('fullscreenchange', () => {
    const on = inFullscreen();
    fsBtn.innerHTML = icon(on ? EXIT : ENTER);
    fsBtn.title = on ? 'Leave fullscreen  (F or Esc)' : 'Fullscreen  (F)';
    settle();
  });

  /* Recentre: gives back the UK view after panning off somewhere. */
  const homeBtn = document.createElement('button');
  homeBtn.type = 'button';
  homeBtn.className = 'tcmx-mapbtn';
  homeBtn.title = 'Back to the UK and Ireland';
  homeBtn.setAttribute('aria-label', 'Back to the UK and Ireland');
  homeBtn.innerHTML = icon('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>');
  homeBtn.addEventListener('click', () => {
    // Leaflet keeps its instance on the container; use it if it is reachable,
    // and do nothing rather than throw if the viewer ever changes shape.
    const m = mapEl._leaflet_map || window.map;
    try { m?.setView([54.6, -3.4], 6); } catch (e) { /* not our map */ }
  });

  const btns = document.createElement('div');
  btns.className = 'tcmx-mapbtns';
  btns.appendChild(fsBtn);
  btns.appendChild(homeBtn);
  app.appendChild(btns);

  /* ── keyboard ───────────────────────────────────────────────────────────── */
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === '\\') { e.preventDefault(); setOpen(document.body.classList.contains('tcmx-side-closed')); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
  });
})();
