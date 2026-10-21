import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, CloudSun, RefreshCw, Loader2,
  ExternalLink, Sparkles, Megaphone, Zap, History } from
'lucide-react';
import WarningCard from '@/components/WarningCard';
import SocialLinks from '@/components/SocialLinks';
import ForecastSection from '@/components/ForecastSection';
import { sized, sizedSet } from '@/lib/sizedImage';
import CombinedBannerStack from '@/components/CombinedBannerStack';
import SeverityFilter from '@/components/SeverityFilter';
// SectionNavigation (the old hamburger) removed — SiteNav in the layout now
// owns page-to-page navigation site-wide.
import WarningsMapModal from '@/components/WarningsMapModal';
import WarningsArchiveModal from '@/components/warnings/WarningsArchiveModal';
import CountdownDisplay from '@/components/CountdownDisplay';
import LocationRadar from '@/components/location/LocationRadar';
import CookieConsent from '@/components/CookieConsent';
import CityConditions from '@/components/home/CityConditions';
import WarningsRefreshBadge from '@/components/home/WarningsRefreshBadge';
import { ConditionChips, ThunderstormRisks } from '@/components/graphics/GraphicMeta';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useTheme } from '@/components/ThemeContext';

// ─── Theme CSS injection ──────────────────────────────────────────────────────
const THEME_STYLES = `
  :root {
    /* Shared */
    --sky: #0ea5e9;
    --sky-dim: rgba(14,165,233,0.15);
    --sky-border: rgba(14,165,233,0.25);
    --amber: #f59e0b;
    --amber-dim: rgba(245,158,11,0.15);
    --blue: #3b82f6;
    --blue-dim: rgba(59,130,246,0.12);

    /* Dark (default) */
    --bg-base:      #0b1220;
    --bg-mid:       #0f1a2e;
    --bg-surface:   rgba(255,255,255,0.04);
    --bg-card:      rgba(255,255,255,0.05);
    --bg-card-hover:rgba(255,255,255,0.08);
    --bg-pill:      rgba(255,255,255,0.08);

    --border:       rgba(255,255,255,0.07);
    --border-hover: rgba(14,165,233,0.4);

    --text-primary:   #f1f5f9;
    --text-secondary: #94a3b8;
    --text-muted:     rgba(148,163,184,0.45);
    --text-tertiary:  #64748b;
    --text-link:      #38bdf8;

    --section-icon-bg:  rgba(14,165,233,0.1);
    --divider:          rgba(255,255,255,0.06);
    --hero-glow-a:      rgba(14,165,233,0.12);
    --hero-glow-b:      rgba(99,102,241,0.08);
    --particle-color:   rgba(255,255,255,0.04);
    --refresh-bg:       rgba(15,26,46,0.95);
    --empty-bg:         rgba(255,255,255,0.03);
    --empty-border:     rgba(255,255,255,0.07);
    --hidden-bg:        rgba(255,255,255,0.02);
    --hidden-border:    rgba(148,163,184,0.15);
    --footer-border:    rgba(255,255,255,0.06);

    --gradient-hero:    linear-gradient(135deg, #0b1220 0%, #0f1a2e 50%, #0c1a30 100%);
    --gradient-hero-overlay: linear-gradient(to bottom, transparent 0%, #0b1220 100%);
    --gradient-title:   linear-gradient(135deg, #f1f5f9 0%, #bae6fd 50%, #cbd5e1 100%);

    --toggle-bg:        rgba(255,255,255,0.07);
    --toggle-border:    rgba(255,255,255,0.12);
  }

  .light-mode {
    --bg-base:      #f0f6ff;
    --bg-mid:       #e8f2ff;
    --bg-surface:   rgba(255,255,255,0.7);
    --bg-card:      rgba(255,255,255,0.85);
    --bg-card-hover:rgba(255,255,255,1);
    --bg-pill:      rgba(14,165,233,0.08);

    --border:       rgba(14,165,233,0.15);
    --border-hover: rgba(14,165,233,0.5);

    --text-primary:   #0f172a;
    --text-secondary: #334155;
    --text-muted:     rgba(51,65,85,0.5);
    --text-tertiary:  #64748b;
    --text-link:      #0284c7;

    --section-icon-bg:  rgba(14,165,233,0.12);
    --divider:          rgba(14,165,233,0.1);
    --hero-glow-a:      rgba(14,165,233,0.2);
    --hero-glow-b:      rgba(99,102,241,0.1);
    --particle-color:   rgba(14,165,233,0.06);
    --refresh-bg:       rgba(240,246,255,0.97);
    --empty-bg:         rgba(255,255,255,0.6);
    --empty-border:     rgba(14,165,233,0.15);
    --hidden-bg:        rgba(255,255,255,0.5);
    --hidden-border:    rgba(14,165,233,0.2);
    --footer-border:    rgba(14,165,233,0.12);

    --gradient-hero:    linear-gradient(135deg, #dbeafe 0%, #eff6ff 50%, #e0f2fe 100%);
    --gradient-hero-overlay: linear-gradient(to bottom, transparent 0%, #f0f6ff 100%);
    --gradient-title:   linear-gradient(135deg, #0f172a 0%, #0369a1 50%, #1e3a5f 100%);

    --toggle-bg:        rgba(14,165,233,0.08);
    --toggle-border:    rgba(14,165,233,0.2);
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
    --ink-3: rgba(74,91,112,0.66);

    --tint-sky:   rgba(2,132,199,0.10);
    --tint-amber: rgba(180,83,9,0.10);
    --tint-red:   rgba(190,18,60,0.09);

    --accent-uk: #1d74c4;
    --page-bg:   #eef3fb;
    --ambient-a: rgba(14,165,233,0.26);
    --ambient-b: rgba(129,140,248,0.20);
    --ambient-c: rgba(45,212,191,0.14);
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
  .lg-ambient i { position: absolute; display: block; border-radius: 50%; }
  .lg-orb-a { width: 70vw; height: 70vw; top: -24vw; left: -20vw;  background: radial-gradient(circle, var(--ambient-a) 0%, transparent 62%); }
  .lg-orb-b { width: 62vw; height: 62vw; top: 12vh;  right: -22vw; background: radial-gradient(circle, var(--ambient-b) 0%, transparent 62%); }
  .lg-orb-c { width: 60vw; height: 60vw; bottom: -22vw; left: 12vw; background: radial-gradient(circle, var(--ambient-c) 0%, transparent 62%); }
}

  /* ── type ──────────────────────────────────────────────────────────────── */
  /* Fluid rather than stepped: the page has to hold at 360px and at 2560px,
     and a handful of breakpoints leaves the in-between sizes looking wrong. */
  .lg-display { font-size: clamp(2rem, 6.2vw, 3.6rem); font-weight: 700;
                letter-spacing: -0.035em; line-height: 1.05; color: var(--ink-1); }
  .lg-title   { font-size: clamp(1.15rem, 2.6vw, 1.5rem); font-weight: 650;
                letter-spacing: -0.02em; color: var(--ink-1); }
  .lg-eyebrow { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.16em;
                text-transform: uppercase; color: var(--ink-3); }
  .lg-body    { font-size: clamp(0.92rem, 1.6vw, 1rem); line-height: 1.62; color: var(--ink-2); }

  /* ── motion ────────────────────────────────────────────────────────────── */
  /* Vestibular safety, and it also makes the page far cheaper on a laptop
     that is already working hard to composite this many blurs. */
  @media (prefers-reduced-motion: reduce) {
    .lg-ambient i { animation: none !important; }
    .lg-lift { transition: none !important; }
    .lg-lift:hover { transform: none !important; }
  }

  /* backdrop-filter is nearly universal now, but where it is missing the panes
     would be near-invisible washes. Fall back to an opaque fill. */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    :root      { --glass-fill: rgba(22,30,46,0.90); --glass-fill-strong: rgba(26,35,54,0.95); }
    .light-mode { --glass-fill: rgba(255,255,255,0.94); --glass-fill-strong: #fff; }
  }


  /* ═══════════════════════════════════════════════════════════════════════
     SUMMER THEME — ultimate tropical paradise
     Applied by toggling class="summer-theme" on <html>.
  ═══════════════════════════════════════════════════════════════════════ */
  .summer-theme {
    --bg-base:        #fffbf0;
    --bg-mid:         #fef3e2;
    --bg-surface:     rgba(255,252,240,0.88);
    --bg-card:        rgba(255,255,255,0.94);
    --bg-card-hover:  rgba(255,255,255,1);
    --bg-pill:        rgba(14,165,233,0.12);

    --border:         rgba(14,165,233,0.22);
    --border-hover:   rgba(14,165,233,0.60);

    --text-primary:   #0c1a2e;
    --text-secondary: #1e4976;
    --text-muted:     rgba(30,73,118,0.55);
    --text-tertiary:  #0369a1;
    --text-link:      #0284c7;

    --section-icon-bg: rgba(14,165,233,0.14);
    --divider:         rgba(14,165,233,0.18);
    --hero-glow-a:     rgba(253,224,71,0.85);
    --hero-glow-b:     rgba(14,165,233,0.50);
    --particle-color:  rgba(255,255,255,0.80);
    --refresh-bg:      rgba(255,251,240,0.98);
    --empty-bg:        rgba(255,255,255,0.80);
    --empty-border:    rgba(14,165,233,0.22);
    --hidden-bg:       rgba(255,255,255,0.60);
    --hidden-border:   rgba(14,165,233,0.28);
    --footer-border:   rgba(251,191,36,0.50);

    /* Perfect midday sky — brilliant cerulean fading to golden horizon */
    --gradient-hero:
      linear-gradient(180deg,
        #0284c7  0%,
        #0ea5e9 12%,
        #38bdf8 24%,
        #7dd3fc 38%,
        #bae6fd 52%,
        #fde68a 68%,
        #fbbf24 80%,
        #f59e0b 90%,
        #fef9c3 100%);
    --gradient-hero-overlay:
      linear-gradient(to bottom,
        rgba(2,132,199,0.05) 0%,
        transparent          28%,
        rgba(255,251,235,0.45) 68%,
        #fffbf0              100%);
    --gradient-title:
      linear-gradient(135deg, #0c4a6e 0%, #0284c7 40%, #0ea5e9 70%, #fbbf24 100%);

    --toggle-bg:     rgba(14,165,233,0.12);
    --toggle-border: rgba(14,165,233,0.38);
  }

  /* Tall hero so the full sky gradient shows */
  .summer-theme header.summer-hero {
    min-height: 580px !important;
  }

  /* ── Animated sun with corona rings ── */
  @keyframes s-sun-beat {
    0%,100% { transform: translateX(-50%) scale(1.00); opacity: 0.95; }
    50%     { transform: translateX(-50%) scale(1.08); opacity: 1.00; }
  }
  @keyframes s-corona-spin {
    to { transform: translateX(-50%) rotate(360deg); }
  }
  @keyframes s-corona-spin-rev {
    to { transform: translateX(-50%) rotate(-360deg); }
  }
  @keyframes s-rays-rotate {
    to { transform: translateX(-50%) rotate(360deg); }
  }

  /* ── Ocean wave at hero base ── */
  .s-wave {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 120px;
    overflow: hidden;
    pointer-events: none;
    z-index: 3;
  }
  .s-wave-inner {
    position: absolute; bottom: 0;
    width: 200%; height: 100%;
    animation: s-wave-scroll 9s linear infinite;
  }
  .s-wave-inner2 {
    position: absolute; bottom: 0;
    width: 200%; height: 100%;
    opacity: 0.55;
    animation: s-wave-scroll 13s linear infinite reverse;
  }
  .s-wave-inner3 {
    position: absolute; bottom: 0;
    width: 200%; height: 100%;
    opacity: 0.35;
    animation: s-wave-scroll 17s linear infinite;
    animation-delay: -4s;
  }
  @keyframes s-wave-scroll {
    from { transform: translateX(0); }
    to   { transform: translateX(-50%); }
  }

  /* ── Seagulls ── */
  .s-birds {
    position: absolute;
    top: 16%;
    left: 0; right: 0;
    pointer-events: none;
    z-index: 4;
    overflow: hidden;
    height: 80px;
  }
  .s-bird {
    position: absolute;
    animation: s-bird-fly 20s linear infinite;
  }
  .s-bird:nth-child(2) { top: 8px;  animation-duration: 27s; animation-delay: -7s; }
  .s-bird:nth-child(3) { top: 28px; animation-duration: 22s; animation-delay: -14s; }
  .s-bird:nth-child(4) { top: 50px; animation-duration: 35s; animation-delay: -3s; }
  @keyframes s-bird-fly {
    from { transform: translateX(-80px); }
    to   { transform: translateX(calc(100vw + 80px)); }
  }
  /* ── Floating sand particles in page body ── */
  @keyframes s-float-up {
    0%   { transform: translateY(0) translateX(0) rotate(0deg);    opacity: 0; }
    10%  { opacity: 0.7; }
    90%  { opacity: 0.4; }
    100% { transform: translateY(-80px) translateX(20px) rotate(180deg); opacity: 0; }
  }
  .s-sand-particle {
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
    animation: s-float-up linear infinite;
  }

  /* ── Page body — layered beach scene ── */
  .summer-theme .summer-page-body {
    background:
      linear-gradient(180deg,
        #fffbf0  0%,
        #fefce8  8%,
        #f0f9ff 30%,
        #e0f2fe 55%,
        #f0fdf4 75%,
        #f0f9ff 100%) !important;
    position: relative;
  }

  /* ── Subtle sand-texture overlay on page body ── */
  .summer-theme .summer-page-body::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      radial-gradient(circle at 20% 15%, rgba(251,191,36,0.06) 0%, transparent 40%),
      radial-gradient(circle at 80% 40%, rgba(14,165,233,0.05) 0%, transparent 35%),
      radial-gradient(circle at 50% 80%, rgba(16,185,129,0.04) 0%, transparent 40%);
    pointer-events: none;
    z-index: 0;
  }

  /* ── Cards get a warm coastal glow ── */
  .summer-theme .summer-section-accent {
    border-left: 4px solid #0ea5e9 !important;
    background: linear-gradient(135deg,
      rgba(14,165,233,0.07) 0%,
      rgba(251,191,36,0.05) 50%,
      rgba(255,255,255,0.80) 100%) !important;
    box-shadow: 0 2px 20px rgba(14,165,233,0.08), 0 1px 4px rgba(251,191,36,0.06) !important;
  }

  /* ── Dividers become golden waterline ── */
  .summer-theme .summer-page-body .h-px {
    background: linear-gradient(to right,
      transparent,
      rgba(251,191,36,0.35) 25%,
      rgba(14,165,233,0.40) 50%,
      rgba(251,191,36,0.35) 75%,
      transparent) !important;
  }

  /* ── Welcome banner — tropical gradient ── */
  .s-welcome-banner {
    background: linear-gradient(135deg,
      rgba(14,165,233,0.18) 0%,
      rgba(251,191,36,0.14) 50%,
      rgba(16,185,129,0.12) 100%);
    border-bottom: 2px solid rgba(14,165,233,0.25);
    padding: 16px 24px;
    text-align: center;
    position: relative;
    overflow: hidden;
  }
  .s-welcome-banner::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg,
      transparent 0%,
      rgba(255,255,255,0.30) 50%,
      transparent 100%);
    animation: s-banner-shimmer 4s ease-in-out infinite;
  }
  @keyframes s-banner-shimmer {
    0%,100% { transform: translateX(-100%); opacity: 0; }
    50%     { transform: translateX(100%);  opacity: 1; }
  }

  /* ── Footer — deep golden beach sunset ── */
  .summer-theme footer {
    background: linear-gradient(180deg,
      #fffbf0  0%,
      #fef9c3 30%,
      #fde68a 65%,
      #fbbf24 100%) !important;
    border-top: 3px solid rgba(251,191,36,0.55) !important;
    position: relative;
    overflow: hidden;
  }
  .summer-theme footer::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: linear-gradient(90deg,
      #0ea5e9 0%, #fbbf24 25%, #f59e0b 50%, #fbbf24 75%, #0ea5e9 100%);
  }

  /* ── Section icon backgrounds glow warm in summer ── */
  .summer-theme [style*="--section-icon-bg"] {
    box-shadow: 0 0 12px rgba(14,165,233,0.15) !important;
  }

  /* ── Warning cards get a warm coastal shadow in summer ── */
  .summer-theme .warning-card-wrapper {
    filter: drop-shadow(0 2px 12px rgba(14,165,233,0.10));
  }

  /* ── Scrollbar — golden beach sand ── */
  .summer-theme ::-webkit-scrollbar { width: 8px; }
  .summer-theme ::-webkit-scrollbar-track { background: #fef9c3; }
  .summer-theme ::-webkit-scrollbar-thumb {
    background: linear-gradient(to bottom, #fbbf24, #0ea5e9);
    border-radius: 4px;
  }
`;
export function injectThemeStyles() {
  if (document.getElementById('home-theme-vars')) return;
  const el = document.createElement('style');
  el.id = 'home-theme-vars';
  el.textContent = THEME_STYLES;
  document.head.appendChild(el);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function classifyWarnings(allWarnings) {
  const now = new Date();
  const active = [],upcoming = [],past = [];
  for (const w of allWarnings) {
    const from = w.validFrom ? new Date(w.validFrom) : null;
    const to = w.validTo ? new Date(w.validTo) : null;
    if (to && to < now) past.push(w);else
    if (from && from > now) upcoming.push(w);else
    active.push(w);
  }
  return { active, upcoming, past };
}

/**
 * The next scheduled warnings refresh: :00 or :30, whichever comes first.
 *
 * The server fetches on those boundaries and nowhere else — opening the page
 * never triggers a fetch — so this countdown is the same for every visitor.
 * When the cached record carries the server's own `next_at`, that wins; this is
 * only the fallback for a record written before that field existed.
 */
function getNextRefreshTime(record) {
  const fromServer = record?.next_at ? new Date(record.next_at) : null;
  if (fromServer && !Number.isNaN(fromServer.getTime()) && fromServer > new Date()) {
    return fromServer;
  }
  const next = new Date();
  next.setSeconds(0, 0);
  if (next.getMinutes() < 30) next.setMinutes(30);
  else next.setHours(next.getHours() + 1, 0);
  return next;
}

function normaliseManualWarning(w) {
  return {
    ...w,
    validFrom: w.valid_from ?? null,
    validTo: w.valid_to ?? null,
    affectedAreas: w.areas ?? [],
    // WarningMap reads `regions` (array) / `region` to draw polygons — manual
    // warnings store their areas under `areas`, so mirror them onto `regions`
    // so the map renders for manual warnings exactly like Met Office ones.
    regions: Array.isArray(w.regions) ? w.regions : (w.areas ?? []),
    isManual: true
  };
}

function classifyManualWarnings(warnings, now) {
  const active = [],upcoming = [],past = [];
  for (const w of warnings) {
    const from = w.validFrom ? new Date(w.validFrom) : null;
    const to = w.validTo ? new Date(w.validTo) : null;
    if (to && to <= now) past.push(w);else
    if (from && from > now) upcoming.push(w);else
    active.push(w);
  }
  return { active, upcoming, past };
}


// ─── Summer decorations ───────────────────────────────────────────────────────





// ─── Section header ──────────────────────────────────────────────────────────

/* ── Section heading ──────────────────────────────────────────────────────────
   An eyebrow and a title, and nothing else.

   The old one carried a rounded icon chip that rotated on hover, a title, a
   desktop subtitle, a separate mobile subtitle and a slot for controls — five
   pieces of furniture above every section, repeated six times down the page.
   Almost all of it restated what the section underneath already showed. What
   survives is the label you need to find your place while scrolling. */
function SectionHeader({ eyebrow, title, action }) {
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
function Section({ id, children, className = '' }) {
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

/* A glass pane. `pad` is off for panes whose child brings its own padding —
   the radar and the city rail both bleed to their own edges. */
/* The page's one button style: a glass chip. Quiet enough to sit three-in-a-row
   without any of them shouting, and big enough to hit on a phone. */
const quietBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 7,
  minHeight: 38, padding: '0 14px', borderRadius: 12,
  cursor: 'pointer', fontFamily: 'inherit',
  fontSize: '0.82rem', fontWeight: 600, letterSpacing: '-0.01em',
  background: 'var(--glass-fill)', border: '1px solid var(--glass-hairline)',
  color: 'var(--ink-2)',
};

function Pane({ children, pad = true, strong = false, className = '', style }) {
  return (
    <div
      className={`lg-pane ${strong ? 'lg-pane-strong' : ''} ${className}`}
      style={{ padding: pad ? 'clamp(16px, 3vw, 26px)' : 0, overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}

// ─── Divider ──────────────────────────────────────────────────────────────────


// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, iconColor, title, body }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="text-center py-20 rounded-3xl backdrop-blur-sm"
      style={{ background: 'var(--empty-bg)', border: '1px solid var(--empty-border)' }}>
      
      <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
        <Icon className={`w-16 h-16 ${iconColor} mx-auto mb-4`} />
      </motion.div>
      <h3 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      <p style={{ color: 'var(--text-secondary)' }}>{body}</p>
    </motion.div>);

}

// ─── Loading spinner ──────────────────────────────────────────────────────────

function LoadingSpinner({ label }) {
  return (
    <motion.div
      key="loading"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="flex flex-col items-center justify-center py-20 gap-4"
      style={{ color: 'var(--text-secondary)' }}>
      
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
        <Loader2 className="w-10 h-10" />
      </motion.div>
      {label &&
      <motion.p animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}>
          {label}
        </motion.p>
      }
    </motion.div>);

}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Home() {
  const queryClient = useQueryClient();
  // ── Theme ──
  // Home shares the app-wide theme state (the same ThemeContext the hamburger
  // menu and the theme-toggle button use). Previously Home kept its OWN local
  // isDark that the toggle never updated, so switching theme didn't refresh
  // Home's custom `light-mode` variables until a full reload. Reading from the
  // shared context keeps the whole page in sync the moment the theme flips.
  const { isDark } = useTheme();

  useEffect(() => {
    injectThemeStyles();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) root.classList.remove('light-mode');
    else        root.classList.add('light-mode');
  }, [isDark]);

  // ── Summer theme — read from localStorage, updated live via storage event.
  //    The admin sets it in AdminSettings which writes localStorage instantly.
  //    The storage event fires in every other open tab so the home page updates
  //    immediately without a page reload — no DB round-trip needed.
  const SUMMER_KEY = 'mwuk_summer_theme';
  const [summerThemeOn, setSummerThemeOn] = useState(() => {
    try { return localStorage.getItem(SUMMER_KEY) === 'true'; } catch { return false; }
  });
  useEffect(() => {
    if (summerThemeOn) document.documentElement.classList.add('summer-theme');
    else               document.documentElement.classList.remove('summer-theme');
    // Strip the Home-only summer class when leaving the page so its styling
    // doesn't leak onto other routes that mount without it.
    return () => document.documentElement.classList.remove('summer-theme');
  }, [summerThemeOn]);
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === SUMMER_KEY) setSummerThemeOn(e.newValue === 'true');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ── Met Office warnings ──
  const [warnings, setWarnings] = useState([]);
  const [upcomingWarnings, setUpcomingWarnings] = useState([]);
  const [allWarnings, setAllWarnings] = useState([]);
  const [loadingWarnings, setLoadingWarnings] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [nextUpdate, setNextUpdate] = useState(null);
  const [warningsSource, setWarningsSource] = useState(null);

  // ── UI ──
  const [isOwner, setIsOwner] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [severityFilter, setSeverityFilter] = useState(null);
  /* null = follow the content: whichever of in-force / upcoming has something
     in it. Once the reader picks a tab, their pick sticks. */
  const [warnTab, setWarnTab] = useState(null);
  const [showWarningsMap, setShowWarningsMap] = useState(false);
  const [showWarningsArchive, setShowWarningsArchive] = useState(false);
  const [showBanners, setShowBanners] = useState(false);
  const [cookieConsentReady, setCookieConsentReady] = useState(false);


  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);




  // ── Announcements — must be declared before the useEffect that reads announcementsLoaded ──
  const { data: announcements = [], isSuccess: announcementsLoaded } = useQuery({
    queryKey: ['announcements'],
    queryFn: async () => {try {return (await base44.entities.Announcement.filter({ is_active: true }, '-created_date')) || [];} catch {return [];}},
    initialData: [], retry: 2, retryDelay: 1000
  });

  // ── Auth bootstrap ──
  useEffect(() => {
    base44.auth.me().
    then((user) => setIsOwner(user?.role === 'admin')).
    catch(() => setIsOwner(false));
    localStorage.removeItem('warnings_cache');
    localStorage.removeItem('upcoming_warnings_cache');
    localStorage.removeItem('warnings_last_fetch_hour');
  }, []);

  // ── Show banners once announcements have loaded (so we don't flash empty and close) ──
  useEffect(() => {
    if (!announcementsLoaded) return;
    const shownThisSession = sessionStorage.getItem('bannersShown');
    if (!shownThisSession) {
      setShowBanners(true);
      sessionStorage.setItem('bannersShown', 'true');
    } else {
      if (!localStorage.getItem('cookie_consent')) setCookieConsentReady(true);
    }
  }, [announcementsLoaded]);

  useEffect(() => {
    if (document.querySelector('script[src="https://elfsightcdn.com/platform.js"]')) return;
    const s = document.createElement('script');
    s.src = 'https://elfsightcdn.com/platform.js';
    s.async = true;
    document.head.appendChild(s);
  }, []);

  const loadWarningsFromDB = useCallback(async (retries = 2) => {
    setLoadingWarnings(true);
    try {
      const records = await base44.entities.CachedWarnings.list();
      const record = records?.[0];
      if (record) {
        const all = Array.isArray(record.all_warnings) ? record.all_warnings : [];
        const { active, upcoming } = classifyWarnings(all);
        setWarnings(active);setUpcomingWarnings(upcoming);setAllWarnings(all);
        setLastUpdated(record.fetched_at ? new Date(record.fetched_at) : null);
        setWarningsSource(record.source || null);
      } else {
        setWarnings([]);setUpcomingWarnings([]);setAllWarnings([]);
      }
      setNextUpdate(getNextRefreshTime(record));
    } catch (error) {
      if (retries > 0) setTimeout(() => loadWarningsFromDB(retries - 1), 1500);else
      {console.error('Error loading warnings:', error);setWarnings([]);setUpcomingWarnings([]);}
    } finally {
      setLoadingWarnings(false);
    }
  }, []);

  const fetchWarnings = useCallback(async (retries = 2) => {
    setRefreshing(true);setLoadingWarnings(true);
    try {
      await base44.functions.invoke('getMetOfficeWarnings', {});
      await loadWarningsFromDB();
    } catch (error) {
      if (retries > 0) setTimeout(() => fetchWarnings(retries - 1), 1500);else
      {console.error('Error fetching:', error);setLoadingWarnings(false);}
    } finally {
      setRefreshing(false);
    }
  }, [loadWarningsFromDB]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadWarningsFromDB();
      // ─── Cold-start bootstrap ─────────────────────────────────────────
      // If the CachedWarnings collection is empty (e.g. first ever page-load
      // on a fresh deployment, or after the cache was cleared), the public
      // Home page would otherwise stay empty until an admin manually pressed
      // Refresh. Trigger a one-off background fetch so data loads automatically.
      try {
        const list = await base44.entities.CachedWarnings.list();
        if (!cancelled && (!list || list.length === 0)) {
          base44.functions.invoke('getMetOfficeWarnings', {})
            .then(() => loadWarningsFromDB())
            .catch((e) => console.warn('[Home] cold-start warnings fetch failed:', e?.message));
        }
      } catch { /* ignore */ }
    })();

    const unsub = base44.entities.CachedWarnings.subscribe((event) => {
      if (event.type === 'create' || event.type === 'update') {
        try {
          const all = Array.isArray(event.data?.all_warnings) ? event.data.all_warnings : [];
          const { active, upcoming } = classifyWarnings(all);
          setWarnings(active);setUpcomingWarnings(upcoming);setAllWarnings(all);
          setLastUpdated(event.data?.fetched_at ? new Date(event.data.fetched_at) : new Date());
          setWarningsSource(event.data?.source || null);
          setNextUpdate(getNextRefreshTime(event.data));
        } catch (err) {console.error('Warning update error:', err);}
      }
    });
    return () => { cancelled = true; unsub(); };
  }, [loadWarningsFromDB]);

  const { isPulling, isRefreshing, pullProgress, onTouchStart, onTouchMove, onTouchEnd } =
  usePullToRefresh(loadWarningsFromDB);

  // ── Remote queries ──
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {try {const l = await base44.entities.SiteSettings.list();return l?.[0] || null;} catch {return null;}},
    refetchInterval: 5000, retry: 2, retryDelay: 1000
  });
  /* The summer theme is a site setting (Admin Settings → Site Control), so every visitor gets it.
     It used to be read only from the admin's own browser storage, where the switch wrote it. */
  useEffect(() => {
    if (typeof settings?.summer_theme === 'boolean') setSummerThemeOn(settings.summer_theme);
  }, [settings?.summer_theme]);
  /* /#forecasts (the admin overview's "Add a forecast graphic") lands on the graphics */
  useEffect(() => {
    if (window.location.hash !== '#forecasts') return undefined;
    const t = setTimeout(() => document.getElementById('forecasts')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 700);
    return () => clearTimeout(t);
  }, []);

  const { data: featuredGraphics = [] } = useQuery({
    queryKey: ['featuredGraphics'],
    queryFn: async () => {try {return (await base44.entities.WeatherGraphic.filter({ is_featured: true, published: true }, '-created_date', 6)) || [];} catch {return [];}},
    retry: 2, retryDelay: 1000
  });

  const { data: forecasts = [] } = useQuery({
    queryKey: ['forecasts'],
    queryFn: async () => {try {return (await base44.entities.WeatherGraphic.filter({ is_forecast: true }, '-created_date', 50)) || [];} catch {return [];}},
    initialData: [], retry: 2, retryDelay: 1000
  });

  /* A MyWeatherUK graphic in force is the most important thing we publish, so while one is
     (not archived, not expired) the graphics section moves up to sit right under the title. */
  const graphicsOnTop = forecasts.some((f) => !f.is_archived && (!f.expires_at || new Date(f.expires_at) > now));

  const { data: appUpdates = [] } = useQuery({
    queryKey: ['appUpdates'],
    // Show every PUBLISHED app update in the banner stack alongside active
    // announcements, so both surface on Home whenever there's one or more.
    queryFn: async () => { try { return (await base44.entities.AppUpdate.filter({ is_published: true }, '-created_date')) || []; } catch { return []; } },
    initialData: [], retry: 1, retryDelay: 2000
  });

  const { data: rawManualWarnings = [] } = useQuery({
    queryKey: ['manualWarnings'],
    queryFn: async () => {try {return (await base44.entities.ManualWarning.list('-valid_from')) || [];} catch {return [];}},
    refetchInterval: 30000, retry: 2, retryDelay: 1000
  });

  const normalisedManual = rawManualWarnings.filter((w) => w.is_published).map(normaliseManualWarning);
  const { active: manualActive, upcoming: manualUpcoming } = classifyManualWarnings(normalisedManual, now);

  // ── Manual warnings with a hand-drawn area OVERRIDE the auto Met Office ones ──
  // When an admin updates a warning and draws the exact area on the map, that
  // warning takes over: the auto Met Office warnings of the same type are hidden
  // so only the admin's drawn area is shown.
  const hasDrawnArea = (w) => Array.isArray(w.area_drawing) && w.area_drawing.length > 0;
  const overriddenTypes = new Set(
    [...manualActive, ...manualUpcoming].filter(hasDrawnArea).map((w) => (w.type || '').toLowerCase())
  );
  const isOverridden = (w) => overriddenTypes.has((w.type || '').toLowerCase());

  const mergedActive = [...warnings.filter((w) => !isOverridden(w)), ...manualActive];
  const mergedUpcoming = [...upcomingWarnings.filter((w) => !isOverridden(w)), ...manualUpcoming];
  const mergedAll = [...allWarnings.filter((w) => !isOverridden(w)), ...normalisedManual];

  // ── Admin-only delete of a manual warning straight from the home page ──
  const deleteManualWarning = useCallback(async (warning) => {
    if (!warning?.id || !warning?.isManual) return;
    if (!window.confirm(`Delete "${warning.title || warning.type + ' Warning'}"? This cannot be undone.`)) return;
    try {
      await base44.entities.ManualWarning.delete(warning.id);
      queryClient.invalidateQueries({ queryKey: ['manualWarnings'] });
    } catch (e) {
      console.error('Failed to delete warning:', e);
      window.alert('Could not delete the warning. Please try again.');
    }
  }, [queryClient]);

  const filteredWarnings = severityFilter ? mergedActive.filter((w) => w.severity === severityFilter) : mergedActive;
  const filteredUpcoming = severityFilter ? mergedUpcoming.filter((w) => w.severity === severityFilter) : mergedUpcoming;
  const totalWarnings = mergedActive.length + mergedUpcoming.length;

  // ── Red Wild Fire nationwide banner ──
  // The Met Office does not issue wildfire warnings; a Red "Wild Fire" manual
  // warning is treated as a Scotland/UK-wide government alert and is called out
  // under the active-warning dot at the top of the page.
  const redWildfire = mergedActive.some(
    (w) => (w.type || '').toLowerCase() === 'wild fire' && (w.severity || '').toLowerCase() === 'red'
  );

  // Countdown is published if the admin has enabled it in settings
  const isCountdownPublished = !!(settings?.countdown_enabled && settings?.countdown_target);

  /* An amber or red warning in force moves the whole warnings block — active,
     upcoming, and the map and past-warnings buttons that belong to them — above
     the city strip. It is the one thing on the page that might need acting on,
     and on a red day it was otherwise four scrolls below Tokyo's temperature.
     Yellow does not qualify: yellows are common enough that promoting them
     would simply be the layout most of the time, which is the arrangement this
     is meant to be an exception to.

     It reads the real warnings rather than the filtered list — a visitor
     narrowing the view to Yellow should not shuffle the page. */
  const promoteWarnings = mergedActive.some(
    (w) => w.severity === 'Amber' || w.severity === 'Red'
  );

  /* Held in a variable rather than written twice: two copies of two hundred
     lines is two copies to keep in step, and they would not stay in step. */
  /* ── Warnings ───────────────────────────────────────────────────────────────
     One pane, two tabs, where there used to be two full-width sections, a rule
     between them, an orphaned row of buttons underneath and a link below that.
     Active and upcoming warnings are the same thing at different times; putting
     them side by side is both shorter and easier to read, and it means the
     panel says "nothing in force" once instead of twice.

     exactly what it used to. */
  const tabs = [
    { id: 'active', label: 'In force', rows: filteredWarnings, upcoming: false },
    { id: 'upcoming', label: 'Upcoming', rows: filteredUpcoming, upcoming: true },
  ];
  /* Default to whichever tab has something in it: on a quiet day "In force" is
     empty and "Upcoming" is where the news is. */
  const fallbackTab = filteredWarnings.length === 0 && filteredUpcoming.length > 0 ? 'upcoming' : 'active';
  const currentTab = tabs.find((t) => t.id === (warnTab || fallbackTab)) || tabs[0];

  const warningsBlock = (
      <Section id="activeWarnings">
        <SectionHeader
          eyebrow="Met Office"
          title="Weather warnings"
          action={
            <>
              <WarningsRefreshBadge
                lastUpdated={lastUpdated}
                nextUpdate={nextUpdate}
                source={warningsSource} />
              {isOwner && (
                <>
                  <button
                    type="button" onClick={fetchWarnings} disabled={loadingWarnings}
                    aria-label="Refresh warnings"
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 34, height: 34, borderRadius: 11, cursor: 'pointer',
                      background: 'var(--glass-fill)', border: '1px solid var(--glass-hairline)',
                      color: 'var(--ink-2)',
                    }}>
                    <motion.span
                      style={{ display: 'flex' }}
                      animate={refreshing ? { rotate: 360 } : {}}
                      transition={{ duration: 0.8, repeat: refreshing ? Infinity : 0, ease: 'linear' }}>
                      {loadingWarnings ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    </motion.span>
                  </button>
                </>
              )}
            </>
          } />

        <Pane>
          {/* Tabs and the severity filter share one row — on a phone the filter
              wraps underneath rather than squeezing the tabs. */}
          <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 16 }}>
            {tabs.length > 1 && (
              <div
                role="tablist"
                style={{
                  display: 'inline-flex', gap: 2, padding: 3, borderRadius: 13,
                  background: 'var(--glass-fill)', border: '1px solid var(--glass-hairline)',
                }}>
                {tabs.map((t) => {
                  const on = t.id === currentTab.id;
                  return (
                    <button
                      key={t.id} type="button" role="tab" aria-selected={on}
                      onClick={() => setWarnTab(t.id)}
                      style={{
                        /* 38px so it is a comfortable tap target on a phone;
                           the padding alone left it at 33. */
                        position: 'relative', minHeight: 38, padding: '0 15px', borderRadius: 10,
                        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                        fontSize: '0.82rem', fontWeight: 650, letterSpacing: '-0.01em',
                        background: on ? 'var(--glass-fill-strong)' : 'transparent',
                        boxShadow: on ? 'var(--glass-shadow), inset 0 1px 0 var(--glass-highlight)' : 'none',
                        color: on ? 'var(--ink-1)' : 'var(--ink-2)',
                        transition: 'background 200ms ease, color 200ms ease',
                      }}>
                      {t.label}
                      {t.rows.length > 0 && (
                        <span style={{
                          marginLeft: 7, padding: '1px 7px', borderRadius: 99,
                          fontSize: '0.68rem', fontWeight: 800,
                          background: 'var(--tint-amber)', color: 'var(--ink-1)',
                        }}>{t.rows.length}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <div style={{ marginLeft: 'auto' }}>
              <SeverityFilter value={severityFilter} onChange={setSeverityFilter} />
            </div>
          </div>

          <AnimatePresence mode="wait">
            {loadingWarnings ? (
              <LoadingSpinner key="loading" label="Fetching Met Office warnings…" />
            ) : currentTab.rows.length > 0 ? (
              <motion.div
                key={`rows-${currentTab.id}-${severityFilter}`}
                className="grid md:grid-cols-2 gap-3 md:gap-4"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {currentTab.rows.map((warning, index) => (
                  <div
                    key={warning.id ?? `${warning.type}-${warning.severity}-${warning.validFrom}-${warning.validTo}-${index}`}
                    className="relative">
                    <WarningCard
                      warning={warning} index={index} isUpcoming={currentTab.upcoming}
                      isOwner={isOwner} onDelete={deleteManualWarning} />
                  </div>
                ))}
              </motion.div>
            ) : (
              <EmptyState
                key={`empty-${currentTab.id}-${severityFilter}`}
                icon={CloudSun} iconColor="text-sky-400"
                title={severityFilter
                  ? `No ${severityFilter} warnings ${currentTab.upcoming ? 'upcoming' : 'in force'}`
                  : currentTab.upcoming ? 'Nothing upcoming' : 'Nothing in force'}
                body={currentTab.upcoming
                  ? 'The Met Office has issued no warnings for the days ahead.'
                  : 'The Met Office has no weather warnings in force for the UK.'} />
            )}
          </AnimatePresence>

          {/* The three ways out of this panel, together, at the foot of the
              thing they belong to — rather than floating below the section. */}
          <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 18 }}>
            <button type="button" onClick={() => setShowWarningsMap(true)} style={quietBtn}>
              <AlertTriangle style={{ width: 14, height: 14 }} /> Warning map
            </button>
            {/* Every warning on record, in its own liquid-glass sheet like the map: a calendar,
                a year at a glance, search and filters, and each warning's map and full detail. */}
            <button type="button" onClick={() => setShowWarningsArchive(true)} style={quietBtn}>
              <History style={{ width: 14, height: 14 }} /> Archive
            </button>
            <a
              href="https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings"
              target="_blank" rel="noopener noreferrer"
              style={{ ...quietBtn, marginLeft: 'auto', textDecoration: 'none' }}>
              Met Office <ExternalLink style={{ width: 13, height: 13 }} />
            </a>
          </div>
        </Pane>
      </Section>
    );

  // ────────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="lg-page min-h-screen scroll-smooth relative"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}>

      {/* ── The ground ──────────────────────────────────────────────────────────
          Three slow orbs behind everything. Glass needs something to refract:
          on a flat fill the panes are just grey rectangles, because there is
          nothing behind them for the blur to bend. This is what they are made
          of. It is fixed, so the panes move over it as you scroll and the light
          behind them shifts — which is the whole illusion. */}
      <div className="lg-ambient" aria-hidden="true">
        <i className="lg-orb-a" /><i className="lg-orb-b" /><i className="lg-orb-c" />
      </div>

      {/* The light/dark switch now lives in the nav bar beside Account, where
          it is one control among the site's others and is on every page rather
          than only this one. It used to be a fixed circle floating over the
          bottom-right corner, on top of whatever happened to be under it. */}

      {/* Pull to refresh */}
      <AnimatePresence>
        {(isPulling || isRefreshing) && (
          <motion.div
            key="ptr"
            initial={{ y: -48, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -48, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 280 }}
            className="lg-pane"
            style={{
              position: 'fixed', top: 'calc(12px + env(safe-area-inset-top, 0px))',
              left: '50%', transform: 'translateX(-50%)',
              zIndex: 9000, pointerEvents: 'none',
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '8px 15px', borderRadius: 99,
            }}>
            <motion.svg
              width="15" height="15" viewBox="0 0 16 16" style={{ flexShrink: 0 }}
              animate={isRefreshing ? { rotate: 360 } : { rotate: pullProgress * 300 }}
              transition={isRefreshing ? { duration: 0.9, repeat: Infinity, ease: 'linear' } : { duration: 0 }}>
              <circle cx="8" cy="8" r="6" fill="none" stroke="var(--glass-hairline)" strokeWidth="2" />
              <motion.circle
                cx="8" cy="8" r="6" fill="none" stroke="var(--sky)" strokeWidth="2" strokeLinecap="round"
                strokeDasharray="37.7"
                strokeDashoffset={isRefreshing ? 0 : 37.7 * (1 - pullProgress)}
                style={{ transformOrigin: '8px 8px', transform: 'rotate(-90deg)' }} />
            </motion.svg>
            <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--ink-2)' }}>
              {isRefreshing ? 'Refreshing…' : pullProgress >= 1 ? 'Release to refresh' : 'Pull to refresh'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <CookieConsent triggerShow={cookieConsentReady} />

      {showBanners && (
        <CombinedBannerStack
          announcements={announcements}
          updates={appUpdates}
          isRestricted={localStorage.getItem('site_access_granted') !== 'true'}
          currentPage="Home"
          onAllDismissed={() => {
            setShowBanners(false);
            if (!localStorage.getItem('cookie_consent')) setCookieConsentReady(true);
          }} />
      )}

      <main style={{ position: 'relative', zIndex: 1, paddingBottom: 'clamp(40px, 8vw, 88px)' }}>

        {/* ══ OPENING ═══════════════════════════════════════════════════════════
            What replaced the old hero: no particle field, no pulsing orbs, no
            giant gradient wordmark, no row of social icons. A logo, the name,
            one line, and the single fact a weather site exists to tell you —
            whether anything is in force right now. Everything else that used to
            be crammed in here had somewhere better to be. */}
        <header
          className="mx-auto w-full px-4 sm:px-6"
          style={{
            maxWidth: 1120,
            paddingTop: 'clamp(40px, 9vw, 92px)',
            paddingBottom: 'clamp(4px, 1vw, 10px)',
            textAlign: 'center',
          }}>
          <motion.div
            initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, ease: [0.22, 0.61, 0.36, 1] }}>

            {settings?.logo_url && (
              <motion.img
                src={settings.logo_url} alt=""
                style={{
                  height: 'clamp(56px, 11vw, 92px)', width: 'auto',
                  margin: '0 auto clamp(16px, 3vw, 24px)', display: 'block',
                  objectFit: 'contain',
                  filter: 'drop-shadow(0 8px 26px rgba(0,0,0,0.28))',
                }}
                initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.06, duration: 0.7, ease: [0.22, 0.61, 0.36, 1] }} />
            )}

            {/* "UK" carries the accent, so the wordmark reads as MyWeather ·
                UK rather than one long run of letters. Split on the suffix
                rather than hard-coding the string: an admin can rename the
                site, and a name that does not end in UK simply renders whole. */}
            <h1 className="lg-display" style={{ margin: 0 }}>
              {(() => {
                const name = settings?.site_name || 'MyWeatherUK';
                if (!/UK$/.test(name) || name.length < 3) return name;
                return (
                  <>
                    {name.slice(0, -2)}
                    <span style={{ color: 'var(--accent-uk)' }}>UK</span>
                  </>
                );
              })()}
            </h1>

            {settings?.description && (
              <p className="lg-body" style={{
                margin: 'clamp(10px, 2vw, 16px) auto 0',
                /* Wide enough that the site's own description reads as two or
                   three lines rather than a narrow column of six. */
                maxWidth: '54ch', textWrap: 'balance',
              }}>
                {settings.description}
              </p>
            )}

            {/* The status line. A live dot and a sentence — the same information
                the old pill and its amber count badge carried between them. */}
            <AnimatePresence>
              {!loadingWarnings && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ delay: 0.18, duration: 0.5 }}
                  className="lg-pane"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 10,
                    padding: '9px 17px', borderRadius: 99,
                    marginTop: 'clamp(18px, 3.5vw, 28px)',
                  }}>
                  <span style={{ position: 'relative', display: 'flex', width: 8, height: 8 }}>
                    <span style={{
                      position: 'absolute', inset: 0, borderRadius: 99,
                      background: mergedActive.length ? '#fbbf24' : '#34d399',
                      opacity: 0.75, animation: 'ping 1.8s cubic-bezier(0,0,0.2,1) infinite',
                    }} />
                    <span style={{
                      position: 'relative', width: 8, height: 8, borderRadius: 99,
                      background: mergedActive.length ? '#fbbf24' : '#34d399',
                    }} />
                  </span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--ink-1)' }}>
                    {totalWarnings === 0
                      ? 'No weather warnings in force'
                      : `${mergedActive.length || totalWarnings} warning${(mergedActive.length || totalWarnings) > 1 ? 's' : ''} in force`}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </header>

        {/* ══ MYWEATHERUK GRAPHICS, when one is in force: straight under the title ══ */}
        {graphicsOnTop && <div id="forecasts"><ForecastSection forecasts={forecasts} isOwner={isOwner} /></div>}

        {/* A red wildfire warning is the one thing allowed to interrupt. */}
        {redWildfire && (
          <Section>
            <motion.div
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="lg-pane"
              style={{
                display: 'flex', alignItems: 'center', gap: 13,
                padding: 'clamp(14px, 3vw, 18px) clamp(16px, 3vw, 22px)',
                background: 'var(--tint-red)',
                borderColor: 'rgba(248,113,113,0.42)',
              }}>
              <AlertTriangle style={{ width: 20, height: 20, color: '#f87171', flexShrink: 0 }} />
              <p style={{
                margin: 0, fontSize: '0.88rem', fontWeight: 700, letterSpacing: '-0.01em',
                color: 'var(--ink-1)',
              }}>
                The UK Government has issued a nationwide wildfire warning
              </p>
            </motion.div>
          </Section>
        )}

        {settings?.countdown_enabled && isCountdownPublished
          && settings?.countdown_target && settings?.countdown_display === 'homepage' && (
          <Section>
            <CountdownDisplay
              target={settings.countdown_target}
              title={settings.countdown_title}
              description={settings.countdown_description} />
          </Section>
        )}

        {/* An amber or red warning outranks everything below the fold. */}
        {promoteWarnings && warningsBlock}

        {/* ══ CONDITIONS ════════════════════════════════════════════════════════ */}
        <Section id="cityConditions">
          <SectionHeader eyebrow="Right now" title="Around the world" />
          <Pane pad={false} style={{ padding: 'clamp(12px, 2.4vw, 18px)' }}>
            <CityConditions />
          </Pane>
        </Section>

        {!promoteWarnings && warningsBlock}

        {/* ══ RADAR ═════════════════════════════════════════════════════════════ */}
        <Section id="liveRadar">
          <SectionHeader eyebrow="Met Office" title="Rain radar" />
          {/* The Met Office 1 km radar for the last three hours, then the UKV's rain for the next
              few, in the Model Data page's colours, light or dark with the page (it brings its own
              ground and controls, so the pane only gives it an edge and a shadow). */}
          <Pane pad={false}>
            <LocationRadar scope="uk" light={!isDark} />
          </Pane>
        </Section>

        {/* ══ FORECASTS ═════════════════════════════════════════════════════════
            Rendered once. It used to appear in two places in the tree, the same
            component with the same props, picked between by whether the list was
            empty — which only moved where its empty state landed. */}
        {!graphicsOnTop && <div id="forecasts"><ForecastSection forecasts={forecasts} isOwner={isOwner} /></div>}

        {/* ══ WHAT'S NEW ════════════════════════════════════════════════════════ */}
        {settings?.news_title?.trim() && (() => {
          const cat = (settings.news_category || 'announcement').toLowerCase();
          const meta = {
            announcement: { color: '#38bdf8', label: 'Announcement', Icon: Megaphone },
            update:       { color: '#34d399', label: 'Update',       Icon: Sparkles },
            alert:        { color: '#f59e0b', label: 'Alert',        Icon: AlertTriangle },
            feature:      { color: '#a78bfa', label: 'New feature',  Icon: Zap },
          }[cat] || { color: '#38bdf8', label: 'Announcement', Icon: Megaphone };
          const { Icon: CatIcon } = meta;
          const publishedAt = settings.news_published_at ? new Date(settings.news_published_at) : null;
          return (
            <Section id="news">
              <SectionHeader eyebrow="From us" title="What's new" />
              <Pane>
                <div className="flex items-center gap-9" style={{ marginBottom: 13, flexWrap: 'wrap', gap: 10 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '4px 11px', borderRadius: 99,
                    background: `${meta.color}1f`, border: `1px solid ${meta.color}44`,
                    color: meta.color, fontSize: 11, fontWeight: 800,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                  }}>
                    <CatIcon style={{ width: 11, height: 11 }} />{meta.label}
                  </span>
                  {publishedAt && (
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      {publishedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  )}
                </div>

                <h3 style={{
                  margin: '0 0 9px', fontSize: 'clamp(1.05rem, 3vw, 1.35rem)', fontWeight: 700,
                  letterSpacing: '-0.025em', lineHeight: 1.25, color: 'var(--ink-1)',
                }}>
                  {settings.news_title}
                </h3>

                {settings.news_body && (
                  <p className="lg-body" style={{ margin: 0, whiteSpace: 'pre-line', maxWidth: '68ch' }}>
                    {settings.news_body}
                  </p>
                )}

                {settings.news_link_url && settings.news_link_label && (
                  <a
                    href={settings.news_link_url}
                    target={settings.news_link_url.startsWith('http') ? '_blank' : undefined}
                    rel="noopener noreferrer"
                    style={{ ...quietBtn, marginTop: 16, textDecoration: 'none', color: 'var(--ink-1)' }}>
                    {settings.news_link_label}
                    <ExternalLink style={{ width: 13, height: 13 }} />
                  </a>
                )}
              </Pane>
            </Section>
          );
        })()}

        {/* ══ GRAPHICS ══════════════════════════════════════════════════════════ */}
        {featuredGraphics?.length > 0 && (
          <Section id="graphics">
            <SectionHeader
              eyebrow="Published"
              title="Latest graphics" />
            <div
              style={{
                display: 'grid', gap: 'clamp(12px, 2vw, 18px)',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
              }}>
              {featuredGraphics.map((graphic, index) => (
                <motion.a
                  key={graphic.id}
                  href={graphic.image_url} target="_blank" rel="noopener noreferrer"
                  className="lg-pane lg-lift"
                  style={{ display: 'block', textDecoration: 'none' }}
                  initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: Math.min(index * 0.06, 0.3), duration: 0.45 }}>
                  <img
                    src={sized(graphic.image_url, 800)} srcSet={sizedSet(graphic.image_url, [480, 800, 1200])}
                    sizes="(min-width: 640px) 360px, 100vw" alt={graphic.title} loading="lazy" decoding="async"
                    style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', objectFit: 'cover' }} />
                  <div style={{ padding: 'clamp(13px, 2.4vw, 17px)' }}>
                    <h3 style={{
                      margin: 0, fontSize: '0.98rem', fontWeight: 650,
                      letterSpacing: '-0.015em', color: 'var(--ink-1)',
                    }}>
                      {graphic.title}
                    </h3>
                    {graphic.description && (
                      <p style={{
                        margin: '5px 0 0', fontSize: '0.84rem', lineHeight: 1.5, color: 'var(--ink-2)',
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}>
                        {graphic.description}
                      </p>
                    )}
                    <ConditionChips graphic={graphic} max={3} className="mt-2.5" />
                    <ThunderstormRisks data={graphic.thunderstorm_data} className="mt-1.5" />
                  </div>
                </motion.a>
              ))}
            </div>
          </Section>
        )}

      </main>

      <WarningsMapModal isOpen={showWarningsMap} onClose={() => setShowWarningsMap(false)} warnings={mergedAll} />
      <WarningsArchiveModal isOpen={showWarningsArchive} onClose={() => setShowWarningsArchive(false)} />

      {/* ══ FOOTER ══════════════════════════════════════════════════════════════
          Where the social links live now. They were in the hero, competing with
          the forecast for the first screen; this is what a footer is for. */}
      <footer style={{ position: 'relative', zIndex: 1 }}>
        <div
          className="mx-auto w-full px-4 sm:px-6"
          style={{
            maxWidth: 1120,
            paddingTop: 'clamp(28px, 5vw, 48px)',
            paddingBottom: 'calc(clamp(28px, 5vw, 48px) + env(safe-area-inset-bottom, 0px))',
          }}>
          <div className="lg-pane" style={{
            padding: 'clamp(18px, 3.2vw, 26px)',
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: 'clamp(12px, 3vw, 20px)',
          }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '0.86rem', fontWeight: 650, color: 'var(--ink-1)' }}>
                © {new Date().getFullYear()} {settings?.site_name || 'MyWeatherUK'}
              </p>
              <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: 'var(--ink-3)' }}>
                Location Weather data sourced from the Met Office Data Hub
              </p>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <p style={{
                margin: '0 0 7px', fontSize: '0.74rem', fontWeight: 700,
                letterSpacing: '0.04em', color: 'var(--ink-3)',
              }}>
                Our Social Media Pages:
              </p>
              <SocialLinks settings={settings} />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
