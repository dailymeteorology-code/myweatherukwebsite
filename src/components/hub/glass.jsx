/* The Hub's glass look: one material for every surface, and the layout helpers its sections are
   built from. Moved out of pages/Home.jsx (17 Nov 2026, the iOS-app redesign: the old home page
   became the Hub, and its warnings moved to their own Warnings tab) so both pages share them. */
import React from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

// ─── Theme CSS injection ──────────────────────────────────────────────────────
export const THEME_STYLES = `
  /* The old palette, cut to the six colours still read elsewhere: the Settings sheet and the
     corner version label are on every page and take theirs from here. Nothing on this page
     uses them any more. */
  :root {
    --bg-card:        rgba(255,255,255,0.05);
    --bg-surface:     rgba(255,255,255,0.04);
    --border:         rgba(255,255,255,0.07);
    --text-primary:   #f1f5f9;
    --text-secondary: #94a3b8;
    --text-muted:     rgba(148,163,184,0.45);
  }
  .light-mode {
    --bg-card:        rgba(255,255,255,0.85);
    --bg-surface:     rgba(255,255,255,0.7);
    --border:         rgba(14,165,233,0.15);
    --text-primary:   #0f172a;
    --text-secondary: #334155;
    --text-muted:     rgba(51,65,85,0.5);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     LIQUID GLASS
     ───────────────────────────────────────────────────────────────────────
     Every surface on the home page is one material: a translucent pane that
     blurs and brightens whatever is behind it, edged with a hairline and lit
     along its top edge. Depth does the work that rules and boxes used to —
     there is not a single divider left on the page.

     THE THREE PARTS THAT MAKE IT READ AS GLASS, none of which is optional:

       · "backdrop-filter: blur() saturate()" — the blur alone looks like
         frosted plastic. The saturation lift is what makes colour bleed
         through the way it does through real glass.
       · "inset 0 1px 0" highlight — a single lit pixel along the top edge.
         This is the specular catch on a bevel, and it is the difference
         between a pane of glass and a grey rectangle.
       · a two-part shadow — one tight and dark for contact, one wide and soft
         for lift. A single shadow reads as a sticker.

     LIGHT AND DARK ARE NOT THE SAME MATERIAL. In the dark the pane is white
     at very low alpha: it brightens what is behind it. In the light it is
     white at high alpha: it hides what is behind it, and needs a real border
     and a stronger shadow to separate at all, because a pale pane on a pale
     ground has no contrast of its own to lean on. Inverting one set of
     numbers for the other gives you milky soup in the light and a smudge in
     the dark, which is the usual way this goes wrong.
     ═══════════════════════════════════════════════════════════════════════ */

  :root {
    --glass-fill:        rgba(255,255,255,0.055);
    --glass-fill-strong: rgba(255,255,255,0.085);
    --glass-hairline:    rgba(255,255,255,0.10);
    --glass-highlight:   rgba(255,255,255,0.14);
    --glass-shadow:      0 1px 2px rgba(0,0,0,0.30), 0 16px 40px -12px rgba(0,0,0,0.60);
    --glass-blur:        22px;

    --ink-1: #f2f6fc;
    --ink-2: #9fb0c6;
    --ink-3: rgba(159,176,198,0.62);
    --sky:   #0ea5e9;

    --tint-sky:   rgba(56,189,248,0.16);
    --tint-amber: rgba(251,191,36,0.16);
    --tint-red:   rgba(248,113,113,0.16);

    /* The wordmark's accent. Bright enough to carry on the dark ground without
       glowing; the light theme takes it down to a deeper blue, because the same
       sky blue on a near-white page is barely a colour at all. */
    --accent-uk: #56b6f5;
    --page-bg:   #070c16;
    /* Strong enough to give the panes something to refract. Below about 0.2
       in the dark the glass has nothing behind it and reads as flat grey. */
    --ambient-a: rgba(14,165,233,0.30);
    --ambient-b: rgba(129,140,248,0.24);
    --ambient-c: rgba(45,212,191,0.16);
  }

  .light-mode {
    --glass-fill:        rgba(255,255,255,0.68);
    --glass-fill-strong: rgba(255,255,255,0.86);
    --glass-hairline:    rgba(15,23,42,0.07);
    --glass-highlight:   rgba(255,255,255,0.92);
    --glass-shadow:      0 1px 2px rgba(15,23,42,0.05), 0 18px 40px -14px rgba(15,23,42,0.20);

    --ink-1: #0b1220;
    --ink-2: #4a5b70;
    --ink-3: rgba(74,91,112,0.74);

    --tint-sky:   rgba(2,132,199,0.10);
    --tint-amber: rgba(180,83,9,0.10);
    --tint-red:   rgba(190,18,60,0.09);

    --accent-uk: #1d74c4;
    --page-bg:   #eef3fb;
    --ambient-a: rgba(14,165,233,0.26);
    --ambient-b: rgba(129,140,248,0.20);
    --ambient-c: rgba(45,212,191,0.14);
  }

  /* The summer theme (Admin Settings → Site Control). It used to repaint a beach scene —
     a sky-gradient hero, waves, seagulls, a golden footer — that went with the old hero;
     on the glass page only its footer and a few colour swaps were left, and they turned
     the warnings countdown dark-on-dark. Now it warms the light behind the glass instead:
     sun-gold where the sky blue was, sea-green below, and a warm "UK". Text and panes keep
     their contrast in both themes. */
  .summer-theme {
    --ambient-a: rgba(251,191,36,0.30);
    --ambient-b: rgba(14,165,233,0.24);
    --ambient-c: rgba(45,212,191,0.22);
    --accent-uk: #fbbf24;
  }
  .summer-theme.light-mode {
    --ambient-a: rgba(251,191,36,0.34);
    --accent-uk: #c2410c;
  }

  /* The page's ground colour.
     A RULE, NOT AN INLINE STYLE. Setting the background SHORTHAND inline to a
     var() left the element with every background longhand empty and no colour
     at all — the shorthand expands at parse time and the custom property is not
     substituted until computed-value time, so the colour was simply dropped and
     the page fell through to whatever the layout painted underneath. In a
     stylesheet the same declaration resolves normally. */
  .lg-page { background: var(--page-bg); transition: background 500ms ease; }

  /* ── the pane ──────────────────────────────────────────────────────────── */
  .lg-pane {
    position: relative;
    border-radius: 24px;
    background: var(--glass-fill);
    border: 1px solid var(--glass-hairline);
    -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(180%);
    backdrop-filter: blur(var(--glass-blur)) saturate(180%);
    box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-highlight);
  }
  .lg-pane-strong { background: var(--glass-fill-strong); }
  /* the status line scrolls to #activeWarnings, the admin overview to #forecasts:
     land them below the fixed site bar rather than under it */
  .lg-page [id] { scroll-margin-top: 64px; }

  /* Interactive panes lift very slightly. Any more and glass reads as plastic. */
  .lg-lift { transition: transform 260ms cubic-bezier(0.22,0.61,0.36,1), box-shadow 260ms ease; }
  @media (hover: hover) {
    .lg-lift:hover {
      transform: translateY(-3px);
      box-shadow: var(--glass-shadow), 0 26px 52px -18px rgba(0,0,0,0.42),
                  inset 0 1px 0 var(--glass-highlight);
    }
  }

  /* ── the ground the panes float on ─────────────────────────────────────── */
  .lg-ambient { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  /* PERFORMANCE: the orbs used to be three ~450px elements with filter:blur(90px)
     drifting forever. Because they never stopped moving, every frosted-glass
     pane in front of them had to re-blur its backdrop on EVERY frame — the
     main source of lag across the site. They are now plain radial gradients
     that do not move: same glow, no per-frame work. */
  .lg-ambient i { position: absolute; display: block; border-radius: 50%; transition: background 600ms ease; }
  .lg-orb-a { width: 70vw; height: 70vw; top: -24vw; left: -20vw;  background: radial-gradient(circle, var(--ambient-a) 0%, transparent 62%); }
  .lg-orb-b { width: 62vw; height: 62vw; top: 12vh;  right: -22vw; background: radial-gradient(circle, var(--ambient-b) 0%, transparent 62%); }
  .lg-orb-c { width: 60vw; height: 60vw; bottom: -22vw; left: 12vw; background: radial-gradient(circle, var(--ambient-c) 0%, transparent 62%); }

  /* ── type ──────────────────────────────────────────────────────────────── */
  /* Fluid rather than stepped: the page has to hold at 360px and at 2560px,
     and a handful of breakpoints leaves the in-between sizes looking wrong.
     The wordmark never actually got its size: a stray closing brace just above
     this rule made the browser throw the rule away, so "MyWeatherUK" rendered
     as 16px body text. */
  .lg-display { font-size: clamp(2.75rem, 9.5vw, 5.4rem); font-weight: 800;
                letter-spacing: -0.045em; line-height: 1; color: var(--ink-1);
                text-wrap: balance; }
  .lg-title   { font-size: clamp(1.15rem, 2.6vw, 1.5rem); font-weight: 650;
                letter-spacing: -0.02em; color: var(--ink-1); }
  .lg-eyebrow { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.16em;
                text-transform: uppercase; color: var(--ink-3); }
  .lg-body    { font-size: clamp(0.92rem, 1.6vw, 1rem); line-height: 1.62; color: var(--ink-2); }

  /* The live dot on the status line. Its own keyframes: it used Tailwind's "ping", which
     only exists in the stylesheet while some class on the site happens to use it. */
  @keyframes lg-ping { 75%, 100% { transform: scale(2.4); opacity: 0; } }
  .lg-ping { animation: lg-ping 1.8s cubic-bezier(0,0,0.2,1) infinite; }
  .lg-status { cursor: pointer; font: inherit; color: inherit; transition: transform 200ms ease, box-shadow 200ms ease; }
  .lg-status:focus-visible { outline: 2px solid var(--accent-uk); outline-offset: 3px; }
  @media (hover: hover) { .lg-status:hover { transform: translateY(-1px); } }

  /* ── motion ────────────────────────────────────────────────────────────── */
  /* Vestibular safety, and it also makes the page far cheaper on a laptop
     that is already working hard to composite this many blurs. */
  @media (prefers-reduced-motion: reduce) {
    .lg-ping { animation: none !important; }
    .lg-lift, .lg-status { transition: none !important; }
    .lg-lift:hover, .lg-status:hover { transform: none !important; }
  }

  /* backdrop-filter is nearly universal now, but where it is missing the panes
     would be near-invisible washes. Fall back to an opaque fill. */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    :root      { --glass-fill: rgba(22,30,46,0.90); --glass-fill-strong: rgba(26,35,54,0.95); }
    .light-mode { --glass-fill: rgba(255,255,255,0.94); --glass-fill-strong: #fff; }
  }
`;
export function injectThemeStyles() {
  let el = document.getElementById('home-theme-vars');
  if (!el) {
    el = document.createElement('style');
    el.id = 'home-theme-vars';
    document.head.appendChild(el);
  }
  if (el.textContent !== THEME_STYLES) el.textContent = THEME_STYLES;
}

// ─── Section header ──────────────────────────────────────────────────────────

/* ── Section heading ──────────────────────────────────────────────────────────
   An eyebrow and a title, and nothing else.

   The old one carried a rounded icon chip that rotated on hover, a title, a
   desktop subtitle, a separate mobile subtitle and a slot for controls — five
   pieces of furniture above every section, repeated six times down the page.
   Almost all of it restated what the section underneath already showed. What
   survives is the label you need to find your place while scrolling. */
export function SectionHeader({ eyebrow, title, action }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4 md:mb-5">
      <div className="min-w-0">
        {eyebrow && <p className="lg-eyebrow" style={{ margin: '0 0 7px' }}>{eyebrow}</p>}
        <h2 className="lg-title" style={{ margin: 0 }}>{title}</h2>
      </div>
      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </div>
  );
}

/* A section: a band of vertical rhythm, and the width the whole page shares. */
export function Section({ id, children, className = '' }) {
  return (
    <motion.section
      id={id}
      className={`mx-auto w-full px-4 sm:px-6 ${className}`}
      style={{ maxWidth: 1120, paddingTop: 'clamp(28px, 5vw, 56px)' }}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, ease: [0.22, 0.61, 0.36, 1] }}>
      {children}
    </motion.section>
  );
}

/* The page's one button style: a glass chip. Quiet enough to sit three-in-a-row
   without any of them shouting, and big enough to hit on a phone. */
export const quietBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 7,
  minHeight: 38, padding: '0 14px', borderRadius: 12,
  cursor: 'pointer', fontFamily: 'inherit',
  fontSize: '0.82rem', fontWeight: 600, letterSpacing: '-0.01em',
  background: 'var(--glass-fill)', border: '1px solid var(--glass-hairline)',
  color: 'var(--ink-2)',
};

/* A glass pane. `pad` is off for panes whose child brings its own padding —
   the radar and the city rail both bleed to their own edges. */
export function Pane({ children, pad = true, strong = false, className = '', style }) {
  return (
    <div
      className={`lg-pane ${strong ? 'lg-pane-strong' : ''} ${className}`}
      style={{ padding: pad ? 'clamp(16px, 3vw, 26px)' : 0, overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

export function EmptyState({ icon: Icon, iconColor, title, body }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      style={{ textAlign: 'center', padding: 'clamp(26px, 6vw, 46px) 12px' }}>
      <Icon style={{ width: 44, height: 44, margin: '0 auto 12px', color: iconColor }} />
      <h3 style={{
        margin: '0 0 6px', fontSize: '1.05rem', fontWeight: 700,
        letterSpacing: '-0.015em', color: 'var(--ink-1)',
      }}>{title}</h3>
      <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: 1.55, color: 'var(--ink-2)' }}>{body}</p>
    </motion.div>
  );
}

// ─── Loading spinner ──────────────────────────────────────────────────────────

export function LoadingSpinner({ label }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="flex flex-col items-center justify-center gap-3"
      style={{ padding: 'clamp(26px, 6vw, 46px) 12px', color: 'var(--ink-2)' }}>
      <Loader2 className="w-8 h-8 animate-spin" />
      {label && <p style={{ margin: 0, fontSize: '0.88rem' }}>{label}</p>}
    </motion.div>
  );
}
