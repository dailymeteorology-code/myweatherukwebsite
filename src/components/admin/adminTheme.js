/* The admin pages' look: liquid glass, in a dark and a light set that follow the site's theme.

   Admin Settings sets the variables on its root (.ad-root, plus .is-light in the light theme), and
   every panel inside it (warnings, announcements, subscriptions, newsletter, access) takes its
   colours from AC, so one switch re-colours the lot. They used to carry four private copies of
   the same dark table, which is why the admin pages had no light mode at all.

   Light and dark are different materials, as on the home page: in the dark the glass is white at
   low alpha over a deep ground, in the light a near-opaque white with real hairlines and shadow. */

export const AC = {
  bg: 'var(--ad-bg)', bgAlt: 'var(--ad-bg-alt)',
  surface: 'var(--ad-surface)', surface2: 'var(--ad-surface2)', surface3: 'var(--ad-surface3)',
  border: 'var(--ad-border)', border2: 'var(--ad-border2)', border3: 'var(--ad-border3)',
  sky: 'var(--ad-sky)', skyLow: 'var(--ad-sky-low)', skyMed: 'var(--ad-sky-med)', skyBorder: 'var(--ad-sky-border)',
  violet: 'var(--ad-violet)', violetLow: 'var(--ad-violet-low)',
  green: 'var(--ad-green)', greenLow: 'var(--ad-green-low)',
  amber: 'var(--ad-amber)', amberLow: 'var(--ad-amber-low)',
  red: 'var(--ad-red)', redLow: 'var(--ad-red-low)',
  orange: 'var(--ad-orange)',
  text: 'var(--ad-text)', textMid: 'var(--ad-text-mid)', textDim: 'var(--ad-text-dim)', textFaint: 'var(--ad-text-faint)',
};

export const ADMIN_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', Inter, Roboto, sans-serif";

/** A colour at the alpha it used to get from two appended hex digits ('22' is about 13%). Works
    for a hex colour and for the variables above alike, which a "#38bdf8" + "22" string never could. */
export const tint = (c, hh) => `color-mix(in srgb, ${c} ${Math.round(parseInt(hh, 16) / 2.55)}%, transparent)`;

export const ADMIN_CSS = `
.ad-root {
  --ad-bg: #070c16; --ad-bg-alt: rgba(9,14,25,.72);
  --ad-surface: rgba(255,255,255,.055); --ad-surface2: rgba(255,255,255,.075); --ad-surface3: rgba(0,0,0,.24);
  --ad-border: rgba(255,255,255,.08); --ad-border2: rgba(255,255,255,.12); --ad-border3: rgba(255,255,255,.18);
  --ad-highlight: rgba(255,255,255,.14); --ad-shadow: 0 1px 2px rgba(0,0,0,.3), 0 16px 40px -12px rgba(0,0,0,.6);
  --ad-sky: #56b6f5; --ad-violet: #a78bfa; --ad-green: #4ade80; --ad-amber: #fbbf24; --ad-red: #f87171; --ad-orange: #fb923c;
  --ad-text: #f2f6fc; --ad-text-mid: #9fb0c6; --ad-text-dim: rgba(159,176,198,.7); --ad-text-faint: rgba(159,176,198,.48);
  --ad-orb-a: rgba(14,165,233,.26); --ad-orb-b: rgba(129,140,248,.2); --ad-orb-c: rgba(236,72,153,.12);
  --ad-accent-ink: #04121f;
}
.ad-root.is-light {
  --ad-bg: #eef3fb; --ad-bg-alt: rgba(255,255,255,.72);
  --ad-surface: rgba(255,255,255,.7); --ad-surface2: rgba(255,255,255,.85); --ad-surface3: rgba(255,255,255,.95);
  --ad-border: rgba(15,23,42,.08); --ad-border2: rgba(15,23,42,.12); --ad-border3: rgba(15,23,42,.18);
  --ad-highlight: rgba(255,255,255,.95); --ad-shadow: 0 1px 2px rgba(15,23,42,.05), 0 18px 40px -14px rgba(15,23,42,.2);
  --ad-sky: #0b72c4; --ad-violet: #7c3aed; --ad-green: #15803d; --ad-amber: #b45309; --ad-red: #dc2626; --ad-orange: #c2410c;
  --ad-text: #0b1220; --ad-text-mid: #4a5b70; --ad-text-dim: rgba(74,91,112,.8); --ad-text-faint: rgba(74,91,112,.6);
  --ad-orb-a: rgba(14,165,233,.2); --ad-orb-b: rgba(129,140,248,.16); --ad-orb-c: rgba(236,72,153,.1);
  --ad-accent-ink: #ffffff;
}
.ad-root {
  --ad-sky-low: color-mix(in srgb, var(--ad-sky) 8%, transparent); --ad-sky-med: color-mix(in srgb, var(--ad-sky) 14%, transparent);
  --ad-sky-border: color-mix(in srgb, var(--ad-sky) 28%, transparent);
  --ad-violet-low: color-mix(in srgb, var(--ad-violet) 10%, transparent); --ad-green-low: color-mix(in srgb, var(--ad-green) 10%, transparent);
  --ad-amber-low: color-mix(in srgb, var(--ad-amber) 10%, transparent); --ad-red-low: color-mix(in srgb, var(--ad-red) 10%, transparent);
  position: relative; min-height: 100vh; min-height: 100dvh; display: flex; background: var(--ad-bg); color: var(--ad-text);
  font-family: ${ADMIN_FONT}; -webkit-font-smoothing: antialiased; transition: background .4s ease;
}
.ad-root *, .ad-root *::before, .ad-root *::after { box-sizing: border-box; }
.ad-root ::-webkit-scrollbar { width: 6px; height: 6px; }
.ad-root ::-webkit-scrollbar-track { background: transparent; }
.ad-root ::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--ad-text-mid) 30%, transparent); border-radius: 10px; }
.ad-root select option { background: var(--ad-bg); color: var(--ad-text); }
.ad-root input[type='datetime-local'], .ad-root input[type='date'], .ad-root input[type='time'] { color-scheme: dark; }
.ad-root.is-light input[type='datetime-local'], .ad-root.is-light input[type='date'], .ad-root.is-light input[type='time'] { color-scheme: light; }
.ad-ambient { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.ad-ambient i { position: absolute; display: block; border-radius: 50%; }
.ad-ambient i:nth-child(1) { width: 70vw; height: 70vw; top: -26vw; left: -18vw; background: radial-gradient(circle, var(--ad-orb-a), transparent 62%); }
.ad-ambient i:nth-child(2) { width: 60vw; height: 60vw; top: 18vh; right: -24vw; background: radial-gradient(circle, var(--ad-orb-b), transparent 62%); }
.ad-ambient i:nth-child(3) { width: 56vw; height: 56vw; bottom: -24vw; left: 18vw; background: radial-gradient(circle, var(--ad-orb-c), transparent 62%); }
.ad-glass { position: relative; background: var(--ad-surface); border: 1px solid var(--ad-border); border-radius: 22px;
  -webkit-backdrop-filter: blur(22px) saturate(180%); backdrop-filter: blur(22px) saturate(180%); box-shadow: var(--ad-shadow), inset 0 1px 0 var(--ad-highlight); }
.ad-card { overflow: hidden; }
.ad-studio { background: #0a1220; color: #f1f5f9; color-scheme: dark; }
.ad-legacy-card { background: var(--ad-surface) !important; border: 1px solid var(--ad-border) !important; border-radius: 20px !important;
  -webkit-backdrop-filter: blur(22px) saturate(180%); backdrop-filter: blur(22px) saturate(180%); box-shadow: var(--ad-shadow), inset 0 1px 0 var(--ad-highlight) !important; color: var(--ad-text); }
.ad-legacy-card.cursor-pointer:hover { background: var(--ad-surface2) !important; }
.ad-picked { border-color: var(--ad-sky) !important; box-shadow: 0 0 0 1px var(--ad-sky), var(--ad-shadow) !important; }
.ad-soft { background: var(--ad-surface2) !important; border-radius: 14px; }
.ad-ink { color: var(--ad-text) !important; } .ad-ink-mid { color: var(--ad-text-mid) !important; } .ad-ink-dim { color: var(--ad-text-dim) !important; }
.ad-field-bg { background: var(--ad-surface3) !important; border-color: var(--ad-border2) !important; color: var(--ad-text) !important; }
.ad-grid-2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
.ad-grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 720px) { .ad-grid-2 { grid-template-columns: minmax(0, 1fr); } .ad-grid-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ad-root * { transition: none !important; } }
`;
