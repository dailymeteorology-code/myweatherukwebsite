import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, CloudSun, RefreshCw, Loader2,
  ExternalLink,
  Newspaper, Sparkles, Megaphone, Zap, Pencil, Check, X, MapPin,
  ChevronDown, ChevronLeft, ChevronRight } from
'lucide-react';
import { Button } from "@/components/ui/button";
import WarningCard from '@/components/WarningCard';
import SocialLinks from '@/components/SocialLinks';
import ForecastSection from '@/components/ForecastSection';
import { sized, sizedSet } from '@/lib/sizedImage';
import CombinedBannerStack from '@/components/CombinedBannerStack';
import SeverityFilter from '@/components/SeverityFilter';
// SectionNavigation (the old hamburger) removed — SiteNav in the layout now
// owns page-to-page navigation site-wide.
import WarningMap from '@/components/WarningMap';
import WarningsMapModal from '@/components/WarningsMapModal';
import CountdownDisplay from '@/components/CountdownDisplay';
import WindyRadarEmbed from '@/components/WindyRadarEmbed';
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

// ─── Particles ────────────────────────────────────────────────────────────────

const particleData = Array.from({ length: 16 }, (_, i) => ({
  id: i,
  x: Math.random() * 100,
  y: Math.random() * 100,
  size: Math.random() * 50 + 12,
  duration: Math.random() * 6 + 5,
  delay: Math.random() * 4
}));

function Particle({ x, y, size, duration, delay }) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        left: `${x}%`, top: `${y}%`,
        width: size, height: size,
        background: 'var(--particle-color)'
      }}
      animate={{ y: [0, -28, 0], opacity: [0.4, 0.8, 0.4], scale: [1, 1.15, 1] }}
      transition={{ duration, delay, repeat: Infinity, ease: 'easeInOut' }} />);


}

// ─── Summer decorations ───────────────────────────────────────────────────────
// A full-width palm tree SVG designed to sit naturally at the edges of the hero.
// Viewbox is wide (600×500) so the tree sits at the left/right edge with sky above it.
function SummerPalmLeft() {
  return (
    <svg style={{ position:'absolute', bottom:0, left:0, width:'clamp(240px,34vw,500px)', height:'auto', pointerEvents:'none', zIndex:4, filter:'drop-shadow(0 12px 28px rgba(0,0,0,0.22))' }}
         viewBox="0 0 520 650" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="sp-trunk" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#713f12"/>
          <stop offset="35%"  stopColor="#92400e"/>
          <stop offset="70%"  stopColor="#a16207"/>
          <stop offset="100%" stopColor="#78350f"/>
        </linearGradient>
        <linearGradient id="sp-trunk2" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%"   stopColor="#431407"/>
          <stop offset="100%" stopColor="#92400e"/>
        </linearGradient>
        <linearGradient id="sp-leaf-d" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#14532d"/>
          <stop offset="50%"  stopColor="#166534"/>
          <stop offset="100%" stopColor="#15803d"/>
        </linearGradient>
        <linearGradient id="sp-leaf-l" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#16a34a"/>
          <stop offset="100%" stopColor="#4ade80"/>
        </linearGradient>
        <linearGradient id="sp-leaf-d2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#052e16"/>
          <stop offset="100%" stopColor="#14532d"/>
        </linearGradient>
        <filter id="sp-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="2" dy="4" stdDeviation="4" floodColor="rgba(0,0,0,0.25)"/>
        </filter>
      </defs>
      {/* Curved trunk with texture */}
      <path d="M55,650 Q72,560 95,480 Q115,408 132,340 Q150,270 162,210 Q172,162 178,118"
            stroke="url(#sp-trunk)" strokeWidth="26" fill="none" strokeLinecap="round"/>
      <path d="M65,650 Q80,560 103,480 Q122,408 138,340 Q156,270 166,210 Q176,162 182,118"
            stroke="url(#sp-trunk2)" strokeWidth="10" fill="none" strokeLinecap="round" opacity="0.4"/>
      {/* Bark rings */}
      {[600,555,510,465,420,375,330,285,240,195,160].map((y,i) => {
        const cx = 55 + (650-y)*0.19;
        return <ellipse key={i} cx={cx} cy={y} rx={14} ry={3.5} fill="none" stroke="#6b2c02" strokeWidth="2" opacity="0.45"/>;
      })}
      {/* Coconuts */}
      <circle cx="178" cy="128" r="16" fill="#7c3b0f"/>
      <circle cx="162" cy="122" r="13" fill="#5c2d09"/>
      <circle cx="194" cy="125" r="12" fill="#92400e"/>
      <circle cx="180" cy="112" r="10" fill="#6b3410"/>
      {/* Crown fronds — 8 sweeping leaves */}
      {/* Far-left drooping frond */}
      <path d="M178,118 Q108,92 28,52 Q38,108 52,142 Q118,128 178,124 Z" fill="url(#sp-leaf-d2)" stroke="#052e16" strokeWidth="0.8"/>
      <path d="M178,118 Q108,92 28,52 Q42,100 54,132 Q118,125 178,122 Z" fill="url(#sp-leaf-l)" opacity="0.28"/>
      {/* Left drooping */}
      <path d="M178,118 Q128,76 68,28 Q84,92 96,132 Q140,124 178,122 Z" fill="url(#sp-leaf-d)" stroke="#14532d" strokeWidth="0.8"/>
      <path d="M178,118 Q128,76 68,28 Q86,88 97,128 Q140,122 178,121 Z" fill="url(#sp-leaf-l)" opacity="0.34"/>
      {/* Upper-left */}
      <path d="M178,118 Q156,62 138,-8 Q162,54 172,106 Q175,113 178,118 Z" fill="url(#sp-leaf-d)" stroke="#14532d" strokeWidth="0.8"/>
      <path d="M178,118 Q156,62 138,-8 Q164,58 174,108 Z" fill="url(#sp-leaf-l)" opacity="0.30"/>
      {/* Straight up */}
      <path d="M178,118 Q186,54 196,-14 Q188,52 184,106 Q182,113 180,118 Z" fill="url(#sp-leaf-d)" stroke="#14532d" strokeWidth="0.8"/>
      {/* Upper-right */}
      <path d="M178,118 Q218,68 264,22 Q238,82 216,112 Q196,120 182,120 Z" fill="url(#sp-leaf-d)" stroke="#14532d" strokeWidth="0.8"/>
      <path d="M178,118 Q218,68 264,22 Q240,85 218,114 Q198,120 182,120 Z" fill="url(#sp-leaf-l)" opacity="0.30"/>
      {/* Right */}
      <path d="M178,118 Q248,108 318,128 Q274,128 228,130 Q200,126 184,122 Z" fill="url(#sp-leaf-d)" stroke="#14532d" strokeWidth="0.8"/>
      <path d="M178,118 Q248,108 318,128 Q275,125 230,127 Q202,124 185,121 Z" fill="url(#sp-leaf-l)" opacity="0.26"/>
      {/* Far-right drooping */}
      <path d="M178,118 Q268,148 368,202 Q302,164 242,158 Q204,144 186,128 Z" fill="url(#sp-leaf-d)" stroke="#14532d" strokeWidth="0.8"/>
    </svg>
  );
}

function SummerPalmRight() {
  return (
    <svg style={{ position:'absolute', bottom:0, right:0, width:'clamp(210px,30vw,440px)', height:'auto', pointerEvents:'none', zIndex:4, transform:'scaleX(-1)', filter:'drop-shadow(0 12px 28px rgba(0,0,0,0.20))' }}
         viewBox="0 0 480 620" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="sp2-trunk" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#713f12"/>
          <stop offset="40%"  stopColor="#a16207"/>
          <stop offset="100%"  stopColor="#78350f"/>
        </linearGradient>
        <linearGradient id="sp2-trunk2" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%"   stopColor="#431407"/>
          <stop offset="100%" stopColor="#92400e"/>
        </linearGradient>
        <linearGradient id="sp2-leaf-d" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#14532d"/>
          <stop offset="100%" stopColor="#15803d"/>
        </linearGradient>
        <linearGradient id="sp2-leaf-l" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#16a34a"/>
          <stop offset="100%" stopColor="#4ade80"/>
        </linearGradient>
        <linearGradient id="sp2-leaf-d2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#052e16"/>
          <stop offset="100%" stopColor="#14532d"/>
        </linearGradient>
      </defs>
      <path d="M50,620 Q65,535 88,455 Q106,385 122,315 Q138,250 148,192 Q156,148 160,108"
            stroke="url(#sp2-trunk)" strokeWidth="24" fill="none" strokeLinecap="round"/>
      <path d="M59,620 Q73,535 95,455 Q112,385 128,315 Q143,250 152,192 Q160,148 163,108"
            stroke="url(#sp2-trunk2)" strokeWidth="10" fill="none" strokeLinecap="round" opacity="0.38"/>
      {[575,530,488,445,402,360,318,276,234,193,158].map((y,i) => {
        const cx = 50 + (620-y)*0.17;
        return <ellipse key={i} cx={cx} cy={y} rx={13} ry={3.2} fill="none" stroke="#6b2c02" strokeWidth="1.8" opacity="0.42"/>;
      })}
      <circle cx="160" cy="118" r="15" fill="#7c3b0f"/>
      <circle cx="146" cy="112" r="12" fill="#5c2d09"/>
      <circle cx="174" cy="115" r="11" fill="#92400e"/>
      <circle cx="162" cy="104" r="9"  fill="#6b3410"/>
      <path d="M160,108 Q88,82 12,44 Q24,100 38,135 Q104,120 160,116 Z" fill="url(#sp2-leaf-d2)" stroke="#052e16" strokeWidth="0.8"/>
      <path d="M160,108 Q110,66 54,22 Q70,84 82,124 Q126,118 160,116 Z" fill="url(#sp2-leaf-d)" stroke="#14532d" strokeWidth="0.8"/>
      <path d="M160,108 Q140,52 126,-16 Q150,50 157,100 Z" fill="url(#sp2-leaf-d)" stroke="#14532d" strokeWidth="0.8"/>
      <path d="M160,108 Q172,48 182,-20 Q172,46 168,98 Z" fill="url(#sp2-leaf-d)" stroke="#14532d" strokeWidth="0.8"/>
      <path d="M160,108 Q204,60 252,16 Q226,76 202,106 Q180,116 166,114 Z" fill="url(#sp2-leaf-d)" stroke="#14532d" strokeWidth="0.8"/>
      <path d="M160,108 Q204,60 252,16 Q228,78 204,108 Q181,116 167,114 Z" fill="url(#sp2-leaf-l)" opacity="0.30"/>
      <path d="M160,108 Q232,98 304,118 Q260,118 212,120 Q184,116 168,112 Z" fill="url(#sp2-leaf-d)" stroke="#14532d" strokeWidth="0.8"/>
      <path d="M160,108 Q250,138 350,192 Q286,154 224,148 Q188,136 170,120 Z" fill="url(#sp2-leaf-d)" stroke="#14532d" strokeWidth="0.8"/>
    </svg>
  );
}

// Tiny seagull — double-wing M shape with body dot
function Seagull({ x, y, scale = 1 }) {
  const s = scale;
  return (
    <svg style={{ position:'absolute', left:x, top:y, width:34*s, height:14*s, pointerEvents:'none' }}
         viewBox="0 0 34 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M0,10 Q5,3 9,6 Q12,9 17,5 Q22,1 26,6 Q29,9 34,6"
            fill="none" stroke="rgba(255,255,255,0.90)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="17" cy="5" r="1.5" fill="rgba(255,255,255,0.70)"/>
    </svg>
  );
}

// Fluffy cloud drifting across the hero sky
function SummerCloud({ style }) {
  return (
    <div aria-hidden="true" style={{
      position:'absolute', pointerEvents:'none', zIndex:2,
      ...style,
    }}>
      <svg viewBox="0 0 140 56" xmlns="http://www.w3.org/2000/svg" style={{width:'100%',height:'100%'}}>
        <ellipse cx="70" cy="36" rx="62" ry="20" fill="rgba(255,255,255,0.82)"/>
        <ellipse cx="48" cy="30" rx="32" ry="22" fill="rgba(255,255,255,0.88)"/>
        <ellipse cx="85" cy="28" rx="38" ry="26" fill="rgba(255,255,255,0.90)"/>
        <ellipse cx="64" cy="24" rx="28" ry="22" fill="rgba(255,255,255,0.95)"/>
        <ellipse cx="92" cy="22" rx="24" ry="19" fill="rgba(255,255,255,0.92)"/>
      </svg>
    </div>
  );
}

// Full summer hero decoration wrapper — everything inside the hero when summer is on
function SummerHeroDecorations() {
  return (
    <>
      {/* Wide rotating sun rays fan — far behind everything */}
      <div aria-hidden="true" style={{
        position:'absolute', top:'-130px', left:'50%',
        transform:'translateX(-50%)',
        width:'clamp(600px,110vw,1500px)', height:'clamp(600px,110vw,1500px)',
        background: `conic-gradient(from 0deg at 50% 50%,
          transparent 0deg,   rgba(253,224,71,0.15) 8deg,  transparent 16deg,
          transparent 26deg,  rgba(253,224,71,0.12) 34deg, transparent 42deg,
          transparent 52deg,  rgba(253,224,71,0.15) 60deg, transparent 68deg,
          transparent 78deg,  rgba(253,224,71,0.12) 86deg, transparent 94deg,
          transparent 104deg, rgba(253,224,71,0.15) 112deg,transparent 120deg,
          transparent 130deg, rgba(253,224,71,0.12) 138deg,transparent 146deg,
          transparent 156deg, rgba(253,224,71,0.15) 164deg,transparent 172deg,
          transparent 182deg, rgba(253,224,71,0.12) 190deg,transparent 198deg,
          transparent 208deg, rgba(253,224,71,0.15) 216deg,transparent 224deg,
          transparent 234deg, rgba(253,224,71,0.12) 242deg,transparent 250deg,
          transparent 260deg, rgba(253,224,71,0.15) 268deg,transparent 276deg,
          transparent 286deg, rgba(253,224,71,0.12) 294deg,transparent 302deg,
          transparent 312deg, rgba(253,224,71,0.15) 320deg,transparent 328deg,
          transparent 338deg, rgba(253,224,71,0.12) 346deg,transparent 354deg)`,
        borderRadius:'50%',
        pointerEvents:'none', zIndex:0,
        animation:'s-rays-rotate 120s linear infinite',
      }}/>
      {/* Outer corona ring */}
      <div aria-hidden="true" style={{
        position:'absolute', top:'-110px', left:'50%',
        transform:'translateX(-50%)',
        width:'clamp(380px,60vw,780px)', height:'clamp(380px,60vw,780px)',
        background:'radial-gradient(circle, transparent 35%, rgba(251,191,36,0.18) 45%, transparent 58%)',
        borderRadius:'50%', pointerEvents:'none', zIndex:1,
        animation:'s-corona-spin 40s linear infinite',
      }}/>
      {/* Inner corona ring — spins opposite */}
      <div aria-hidden="true" style={{
        position:'absolute', top:'-105px', left:'50%',
        transform:'translateX(-50%)',
        width:'clamp(300px,48vw,620px)', height:'clamp(300px,48vw,620px)',
        background:'radial-gradient(circle, transparent 42%, rgba(253,224,71,0.22) 50%, transparent 60%)',
        borderRadius:'50%', pointerEvents:'none', zIndex:1,
        animation:'s-corona-spin-rev 28s linear infinite',
      }}/>
      {/* Glowing sun disc — crisp white-yellow core */}
      <div aria-hidden="true" style={{
        position:'absolute', top:'-95px', left:'50%',
        transform:'translateX(-50%)',
        width:'clamp(260px,40vw,520px)', height:'clamp(260px,40vw,520px)',
        background:'radial-gradient(circle, #fff9c4 0%, rgba(253,224,71,1) 12%, rgba(251,191,36,0.90) 22%, rgba(251,146,60,0.50) 42%, rgba(234,88,12,0.12) 64%, transparent 78%)',
        borderRadius:'50%', pointerEvents:'none', zIndex:2,
        animation:'s-sun-beat 6s ease-in-out infinite',
        boxShadow:'0 0 60px 20px rgba(251,191,36,0.25), 0 0 120px 40px rgba(251,191,36,0.10)',
      }}/>
      {/* Drifting clouds */}
      <SummerCloud style={{ top:'14%', left:'-8%', width:'clamp(100px,18vw,220px)', height:'auto', animation:'s-wave-scroll 55s linear infinite', animationDelay:'-18s', opacity:0.70 }}/>
      <SummerCloud style={{ top:'22%', left:'-5%', width:'clamp(70px,12vw,160px)', height:'auto', animation:'s-wave-scroll 70s linear infinite', animationDelay:'-35s', opacity:0.55 }}/>
      <SummerCloud style={{ top:'8%', left:'-12%', width:'clamp(120px,22vw,280px)', height:'auto', animation:'s-wave-scroll 45s linear infinite', animationDelay:'-8s', opacity:0.60 }}/>
      {/* Horizon gold shimmer line */}
      <div aria-hidden="true" style={{
        position:'absolute', bottom:'112px', left:0, right:0, height:'48px',
        background:'linear-gradient(to right, transparent 0%, rgba(251,191,36,0.25) 20%, rgba(253,224,71,0.55) 50%, rgba(251,191,36,0.25) 80%, transparent 100%)',
        pointerEvents:'none', zIndex:2,
        filter:'blur(8px)',
      }}/>
      {/* Beach sand strip at base of hero */}
      <div aria-hidden="true" style={{
        position:'absolute', bottom:'100px', left:0, right:0, height:'22px',
        background:'linear-gradient(to bottom, transparent, rgba(254,243,199,0.55))',
        pointerEvents:'none', zIndex:2,
      }}/>
      {/* Left palm tree */}
      <SummerPalmLeft />
      {/* Right palm tree */}
      <SummerPalmRight />
      {/* 3-layer animated ocean waves */}
      <div className="s-wave" aria-hidden="true">
        <div className="s-wave-inner">
          <svg viewBox="0 0 1440 120" style={{width:'100%',height:'120px'}} preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="w-deep" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(14,165,233,0.75)"/>
                <stop offset="100%" stopColor="rgba(3,105,161,0.85)"/>
              </linearGradient>
              <linearGradient id="w-mid" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(56,189,248,0.60)"/>
                <stop offset="100%" stopColor="rgba(14,165,233,0.70)"/>
              </linearGradient>
            </defs>
            <path d="M0,44 C100,88 220,14 360,44 C500,74 620,8 720,44 C820,80 960,12 1080,44 C1200,76 1340,10 1440,44 L1440,120 L0,120 Z" fill="url(#w-deep)"/>
            <path d="M0,62 C150,32 320,92 520,62 C720,32 900,85 1080,62 C1260,39 1380,76 1440,60 L1440,120 L0,120 Z" fill="url(#w-mid)"/>
            <path d="M0,80 C80,62 180,94 280,80 C380,66 480,94 580,80 C680,66 780,92 880,80 C980,68 1080,92 1180,80 C1280,68 1370,88 1440,80 L1440,120 L0,120 Z" fill="rgba(125,211,252,0.55)"/>
            <path d="M0,96 C60,88 140,104 220,96 C300,88 380,104 460,96 C540,88 620,104 700,96 C780,88 860,104 940,96 C1020,88 1100,104 1180,96 C1260,88 1350,102 1440,96 L1440,120 L0,120 Z" fill="rgba(186,230,253,0.50)"/>
          </svg>
          <svg viewBox="0 0 1440 120" style={{width:'100%',height:'120px'}} preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0,44 C100,88 220,14 360,44 C500,74 620,8 720,44 C820,80 960,12 1080,44 C1200,76 1340,10 1440,44 L1440,120 L0,120 Z" fill="url(#w-deep)"/>
            <path d="M0,62 C150,32 320,92 520,62 C720,32 900,85 1080,62 C1260,39 1380,76 1440,60 L1440,120 L0,120 Z" fill="url(#w-mid)"/>
            <path d="M0,80 C80,62 180,94 280,80 C380,66 480,94 580,80 C680,66 780,92 880,80 C980,68 1080,92 1180,80 C1280,68 1370,88 1440,80 L1440,120 L0,120 Z" fill="rgba(125,211,252,0.55)"/>
            <path d="M0,96 C60,88 140,104 220,96 C300,88 380,104 460,96 C540,88 620,104 700,96 C780,88 860,104 940,96 C1020,88 1100,104 1180,96 C1260,88 1350,102 1440,96 L1440,120 L0,120 Z" fill="rgba(186,230,253,0.50)"/>
          </svg>
        </div>
        <div className="s-wave-inner2">
          <svg viewBox="0 0 1440 120" style={{width:'100%',height:'120px'}} preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0,52 C160,22 340,84 520,52 C700,20 880,78 1060,52 C1240,26 1340,72 1440,54 L1440,120 L0,120 Z" fill="rgba(56,189,248,0.28)"/>
            <path d="M0,70 C120,52 260,88 400,70 C540,52 680,88 820,70 C960,52 1100,88 1240,70 C1320,60 1390,78 1440,72 L1440,120 L0,120 Z" fill="rgba(14,165,233,0.22)"/>
          </svg>
          <svg viewBox="0 0 1440 120" style={{width:'100%',height:'120px'}} preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0,52 C160,22 340,84 520,52 C700,20 880,78 1060,52 C1240,26 1340,72 1440,54 L1440,120 L0,120 Z" fill="rgba(56,189,248,0.28)"/>
            <path d="M0,70 C120,52 260,88 400,70 C540,52 680,88 820,70 C960,52 1100,88 1240,70 C1320,60 1390,78 1440,72 L1440,120 L0,120 Z" fill="rgba(14,165,233,0.22)"/>
          </svg>
        </div>
        <div className="s-wave-inner3">
          <svg viewBox="0 0 1440 120" style={{width:'100%',height:'120px'}} preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0,86 C200,72 400,100 600,86 C800,72 1000,100 1200,86 C1300,80 1380,92 1440,88 L1440,120 L0,120 Z" fill="rgba(186,230,253,0.38)"/>
          </svg>
          <svg viewBox="0 0 1440 120" style={{width:'100%',height:'120px'}} preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0,86 C200,72 400,100 600,86 C800,72 1000,100 1200,86 C1300,80 1380,92 1440,88 L1440,120 L0,120 Z" fill="rgba(186,230,253,0.38)"/>
          </svg>
        </div>
      </div>
      {/* Flying seagulls — 4 birds at different speeds & sizes */}
      <div className="s-birds" aria-hidden="true">
        <div className="s-bird" style={{top:4}}>
          <Seagull x={0} y={0} scale={1.2}/>
        </div>
        <div className="s-bird" style={{animationDuration:'25s',animationDelay:'-9s',top:16}}>
          <Seagull x={0} y={0} scale={0.85}/>
        </div>
        <div className="s-bird" style={{animationDuration:'32s',animationDelay:'-16s',top:32}}>
          <Seagull x={0} y={0} scale={0.65}/>
        </div>
        <div className="s-bird" style={{animationDuration:'42s',animationDelay:'-4s',top:54}}>
          <Seagull x={0} y={0} scale={0.50}/>
        </div>
      </div>
    </>
  );
}

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

// ─── Warnings archive ─────────────────────────────────────────────────────────
/* Every UK warning the site has on record, a day at a time.
 *
 * Reads /api/warning-archive, which merges the permanent archive written on
 * every warnings refresh with the manually-issued warnings (the only history
 * predating the archive, and the ones that carry a drawn area).
 *
 * THE CALENDAR STARTS AT 1 JANUARY 2026 AND NEVER ENDS. Months before the
 * archive began recording are shown greyed with a note rather than as empty
 * squares, because "no warnings that day" and "nobody was writing anything
 * down yet" are completely different claims and a blank square makes the
 * second look like the first.
 */
const SEV_UI = {
  red:    { label: 'Red',    dot: '#ef4444', fill: 'rgba(239,68,68,0.22)',  edge: 'rgba(239,68,68,0.55)' },
  amber:  { label: 'Amber',  dot: '#f59e0b', fill: 'rgba(245,158,11,0.20)', edge: 'rgba(245,158,11,0.5)' },
  yellow: { label: 'Yellow', dot: '#facc15', fill: 'rgba(250,204,21,0.16)', edge: 'rgba(250,204,21,0.45)' },
};
const SEV_ORDER = ['red', 'amber', 'yellow'];
const ymd = (d) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(d);

function WarningsArchive({ mapUrl }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [cursor, setCursor] = useState(null);   // first of the month on show
  const [day, setDay] = useState(null);
  const [openSeverity, setOpenSeverity] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/warning-archive')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (cancelled) return;
        setData(j);
        /* Open on the most recent month that actually has something in it, not
           on today — an empty current month is a poor first impression of an
           archive and hides the fact that it holds anything at all. */
        const withData = Object.keys(j.days || {}).sort();
        const latest = withData.length ? withData[withData.length - 1] : ymd(new Date());
        const [y, m] = latest.split('-').map(Number);
        setCursor(new Date(Date.UTC(y, m - 1, 1)));
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  const grid = useMemo(() => {
    if (!cursor) return null;
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const first = new Date(Date.UTC(y, m, 1));
    const total = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    // Monday-first, the way a UK calendar reads.
    const lead = (first.getUTCDay() + 6) % 7;
    const cells = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= total; d += 1) cells.push(`${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    return { cells, label: first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  }, [cursor]);

  /* MEMOISED, AND THAT IS THE WHOLE FIX FOR THE FLICKERING MAP.
     WarningMap rebuilds its Leaflet instance whenever its `warning` prop
     changes identity, and this list was being rebuilt — with a fresh object
     spread into <WarningMap> on top — on every single render. So each map tore
     itself down and reconstructed on every tick of anything else on the page.
     Stable references, one build each.

     The severity is capitalised here rather than at the point of use, because
     WarningMap looks its colours up in a table keyed 'Yellow' / 'Amber' / 'Red'
     and falls back to Yellow on a miss — so the lower-cased values the archive
     stores were painting every red warning yellow.

     ABOVE THE EARLY RETURNS, because a hook called after one runs on some
     renders and not others, and React counts them. */
  const selected = useMemo(() => {
    if (!day || !data) return [];
    return data.warnings
      .filter((w) => (w.days || []).includes(day))
      .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))
      .map((w) => ({
        ...w,
        /* Two spellings on purpose: `severity` capitalised for WarningMap and
           the label it prints, `sevKey` lower for this file's own palette.
           Normalising to one would just move the mismatch somewhere else. */
        severity: (w.severity || 'yellow').replace(/^./, (c) => c.toUpperCase()),
        sevKey: (w.severity || 'yellow').toLowerCase(),
        validFrom: w.valid_from,
        validTo: w.valid_to,
      }));
  }, [data, day]);

  if (error) {
    return <p className="text-sm" style={{ color: 'var(--ink-2)' }}>The archive is unavailable right now ({error}).</p>;
  }
  if (!data || !grid) {
    return <p className="text-sm" style={{ color: 'var(--ink-2)' }}>Loading the archive…</p>;
  }

  const epochMonth = data.epoch.slice(0, 7);
  const thisMonth = grid.cells.find(Boolean)?.slice(0, 7) ?? epochMonth;
  const todayMonth = ymd(new Date()).slice(0, 7);
  const shift = (n) => setCursor((c) => new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + n, 1)));

  const fmtTime = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—'
      : d.toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-4">
      {/* Running totals, each one expandable into the breakdown by warning
          type — "how many ambers" is the question people ask, "how many of
          them were rain" is the one they ask next. */}
      <div className="flex flex-wrap gap-2">
        {SEV_ORDER.map((s) => {
          const n = data.totals[s] || 0;
          const open = openSeverity === s;
          return (
            <button
              key={s} type="button"
              onClick={() => setOpenSeverity(open ? null : s)}
              aria-expanded={open}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '8px 14px', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
                background: open ? SEV_UI[s].fill : 'var(--glass-fill)',
                border: `1px solid ${open ? SEV_UI[s].edge : 'var(--glass-hairline)'}`,
                color: 'var(--ink-1)',
              }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: SEV_UI[s].dot }} />
              <span className="text-[13px] font-bold">{n.toLocaleString()}</span>
              <span className="text-[12px]" style={{ color: 'var(--ink-2)' }}>{SEV_UI[s].label}</span>
              <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--ink-3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }} />
            </button>
          );
        })}
      </div>

      {/* No negative margin on this row. The parent is `space-y-4`, which puts
          a 16px top margin on every child after the first; overriding it with
          -4px did not tighten that gap, it removed the gap entirely and then
          pulled the type chips 4px up INTO the totals row above them. */}
      {openSeverity && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(data.byType)
            .filter(([, c]) => c[openSeverity] > 0)
            .sort((a, b) => b[1][openSeverity] - a[1][openSeverity])
            .map(([type, c]) => (
              <span key={type} className="text-[12px]"
                    style={{ padding: '5px 11px', borderRadius: 99, background: 'var(--glass-fill)', border: '1px solid var(--glass-hairline)', color: 'var(--ink-1)' }}>
                {type} <strong>{c[openSeverity]}</strong>
              </span>
            ))}
          {!Object.values(data.byType).some((c) => c[openSeverity] > 0) && (
            <span className="text-[12.5px]" style={{ color: 'var(--ink-2)' }}>
              No {SEV_UI[openSeverity].label.toLowerCase()} warnings on record yet.
            </span>
          )}
        </div>
      )}

      {/* Month */}
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => shift(-1)} disabled={thisMonth <= epochMonth}
                style={{ ...quietBtn, opacity: thisMonth <= epochMonth ? 0.4 : 1 }}>
          <ChevronLeft style={{ width: 14, height: 14 }} />
        </button>
        <span className="text-[13.5px] font-bold" style={{ color: 'var(--ink-1)' }}>{grid.label}</span>
        <button type="button" onClick={() => shift(1)} disabled={thisMonth >= todayMonth}
                style={{ ...quietBtn, opacity: thisMonth >= todayMonth ? 0.4 : 1 }}>
          <ChevronRight style={{ width: 14, height: 14 }} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="text-center text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>{d}</span>
        ))}
        {grid.cells.map((iso, i) => {
          if (!iso) return <span key={`pad${i}`} />;
          const info = data.days[iso];
          const future = iso > ymd(new Date());
          const on = day === iso;
          const ui = info ? SEV_UI[info.top] : null;
          return (
            <button
              key={iso} type="button" disabled={future}
              onClick={() => setDay(on ? null : iso)}
              title={info ? `${Object.entries(info.counts).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`).join(', ')}` : 'No warnings'}
              style={{
                aspectRatio: '1', borderRadius: 11, cursor: future ? 'default' : 'pointer',
                fontFamily: 'inherit', fontSize: 12.5, fontWeight: info ? 800 : 500,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                background: ui ? ui.fill : 'var(--glass-fill)',
                border: `1px solid ${on ? 'var(--ink-1)' : ui ? ui.edge : 'var(--glass-hairline)'}`,
                color: future ? 'var(--ink-3)' : 'var(--ink-1)',
                opacity: future ? 0.35 : 1,
                transition: 'border-color 160ms ease',
              }}>
              {Number(iso.slice(-2))}
              {info && <span style={{ width: 4, height: 4, borderRadius: '50%', background: ui.dot }} />}
            </button>
          );
        })}
      </div>

      {thisMonth < (data.recordingSince || '').slice(0, 7) && (
        <p className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
          Nothing was being recorded this month — the archive only holds what it has seen since it
          started, plus warnings issued by hand. An empty day here means no record, not no warning.
        </p>
      )}

      {/* The selected day */}
      {day && (
        <div className="space-y-3" style={{ borderTop: '1px solid var(--glass-hairline)', paddingTop: 16 }}>
          <h4 className="text-[14px] font-extrabold" style={{ color: 'var(--ink-1)' }}>
            {new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}
          </h4>
          {selected.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>No warnings on record for this day.</p>
          ) : selected.map((w) => (
            <div key={w.id} style={{ borderRadius: 16, padding: 14, background: 'var(--glass-fill)', border: `1px solid ${SEV_UI[w.sevKey]?.edge || 'var(--glass-hairline)'}` }}>
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: SEV_UI[w.sevKey]?.dot || '#facc15' }} />
                <strong className="text-[13.5px]" style={{ color: 'var(--ink-1)' }}>
                  {SEV_UI[w.sevKey]?.label} warning of {w.type}
                </strong>
                {w.issued_by === 'manual' && (
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>Issued here</span>
                )}
              </div>
              <p className="text-[12px] mb-2" style={{ color: 'var(--ink-2)' }}>
                {fmtTime(w.valid_from)} → {w.valid_to ? fmtTime(w.valid_to) : 'ongoing'}
              </p>
              {w.description && (
                <p className="text-[13px] mb-2" style={{ color: 'var(--ink-1)', lineHeight: 1.5 }}>{w.description}</p>
              )}
              {!!(w.regions || []).length && (
                <p className="text-[11.5px] mb-2" style={{ color: 'var(--ink-3)' }}>{w.regions.join(' · ')}</p>
              )}
              {/* How it actually looked, using the same map the live warning
                  cards use rather than a description of a shape. */}
              {/* `w` straight through — spreading a fresh object in here was
                  handing WarningMap a new prop identity on every render and
                  making it rebuild the map each time. */}
              <WarningMap warning={w} height={200} mapUrl={mapUrl} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Divider ──────────────────────────────────────────────────────────────────

function Divider() {
  return (
    <motion.div
      className="max-w-6xl mx-auto px-4"
      initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }}
      viewport={{ once: true }} transition={{ duration: 0.8 }}>
      
      <div className="h-px" style={{ background: `linear-gradient(to right, transparent, var(--divider) 30%, var(--border) 50%, var(--divider) 70%, transparent)` }} />
    </motion.div>);

}

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
  const { isDark, toggleTheme } = useTheme();

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
  const [pastWarnings, setPastWarnings] = useState([]);
  const [allWarnings, setAllWarnings] = useState([]);
  const [loadingWarnings, setLoadingWarnings] = useState(true);
  const [warningMapUrl, setWarningMapUrl] = useState('https://www.metoffice.gov.uk/public/data/PWSCache/WarningsMaps/UK');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [nextUpdate, setNextUpdate] = useState(null);
  const [warningsSource, setWarningsSource] = useState(null);
  const [timeUntilUpdate, setTimeUntilUpdate] = useState('');

  // ── UI ──
  const [isOwner, setIsOwner] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [severityFilter, setSeverityFilter] = useState(null);
  /* null = follow the content: whichever of in-force / upcoming has something
     in it. Once the reader picks a tab, their pick sticks. */
  const [warnTab, setWarnTab] = useState(null);
  const [showWarningsMap, setShowWarningsMap] = useState(false);
  const [showBanners, setShowBanners] = useState(false);
  const [cookieConsentReady, setCookieConsentReady] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [scrollDirection, setScrollDirection] = useState('down');


  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);


  // ── Scroll direction ── (ref-tracked so the listener is attached once,
  //    not re-subscribed on every scroll frame)
  const lastScrollRef = useRef(0);
  useEffect(() => {
    const handle = () => {
      const cur = window.scrollY;
      setScrollDirection(cur > lastScrollRef.current ? 'down' : 'up');
      lastScrollRef.current = cur;
      setLastScrollY(cur);
    };
    window.addEventListener('scroll', handle, { passive: true });
    return () => window.removeEventListener('scroll', handle);
  }, []);

  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0]);
  const heroScale = useTransform(scrollY, [0, 300], [1, 0.95]);
  const heroY = useTransform(scrollY, [0, 300], [0, 50]);

  // ── Announcements — must be declared before the useEffect that reads announcementsLoaded ──
  const { data: announcements = [], isSuccess: announcementsLoaded } = useQuery({
    queryKey: ['announcements'],
    queryFn: async () => {try {return (await base44.entities.Announcement.filter({ is_active: true }, '-created_date')) || [];} catch {return [];}},
    initialData: [], retry: 2, retryDelay: 1000
  });

  // ── Auth bootstrap ──
  useEffect(() => {
    base44.auth.me().
    then((user) => {setIsOwner(user?.role === 'admin');setUserRole(user?.role);}).
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

  useEffect(() => {
    if (!nextUpdate) return;
    const tick = setInterval(() => {
      const diff = nextUpdate - new Date();
      if (diff <= 0) {
        setTimeUntilUpdate('Updating...');
      } else {
        const mins = Math.floor(diff % (1000 * 3600) / 60000);
        const secs = Math.floor(diff % 60000 / 1000);
        setTimeUntilUpdate(`${nextUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${mins}m ${secs}s)`);
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [nextUpdate]);

  const loadWarningsFromDB = useCallback(async (retries = 2) => {
    setLoadingWarnings(true);
    try {
      const records = await base44.entities.CachedWarnings.list();
      const record = records?.[0];
      if (record) {
        const all = Array.isArray(record.all_warnings) ? record.all_warnings : [];
        const { active, upcoming, past } = classifyWarnings(all);
        setWarnings(active);setUpcomingWarnings(upcoming);
        setPastWarnings(past);setAllWarnings(all);
        setLastUpdated(record.fetched_at ? new Date(record.fetched_at) : null);
        setWarningsSource(record.source || null);
        if (record.map_url) setWarningMapUrl(record.map_url);
      } else {
        setWarnings([]);setUpcomingWarnings([]);setPastWarnings([]);setAllWarnings([]);
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
      } catch (e) { /* ignore */ }
    })();

    const unsub = base44.entities.CachedWarnings.subscribe((event) => {
      if (event.type === 'create' || event.type === 'update') {
        try {
          const all = Array.isArray(event.data?.all_warnings) ? event.data.all_warnings : [];
          const { active, upcoming, past } = classifyWarnings(all);
          setWarnings(active);setUpcomingWarnings(upcoming);
          setPastWarnings(past);setAllWarnings(all);
          setLastUpdated(event.data?.fetched_at ? new Date(event.data.fetched_at) : new Date());
          setWarningsSource(event.data?.source || null);
          if (event.data?.map_url) setWarningMapUrl(event.data.map_url);
          setNextUpdate(getNextRefreshTime(event.data));
        } catch (err) {console.error('Warning update error:', err);}
      }
    });
    return () => { cancelled = true; unsub(); };
  }, [loadWarningsFromDB]);

  const { isPulling, isRefreshing, pullProgress, pullDistance, onTouchStart, onTouchMove, onTouchEnd } =
  usePullToRefresh(loadWarningsFromDB);

  // ── Remote queries ──
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {try {const l = await base44.entities.SiteSettings.list();return l?.[0] || null;} catch {return null;}},
    refetchInterval: 5000, retry: 2, retryDelay: 1000
  });

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

  const { data: publishedFeatures = [] } = useQuery({
    queryKey: ['publishedFeatures'],
    queryFn: async () => { return []; }, // Feature flags not in schema — always return empty
    initialData: [], retry: false
  });

  const { data: rawManualWarnings = [] } = useQuery({
    queryKey: ['manualWarnings'],
    queryFn: async () => {try {return (await base44.entities.ManualWarning.list('-valid_from')) || [];} catch {return [];}},
    refetchInterval: 30000, retry: 2, retryDelay: 1000
  });

  const normalisedManual = rawManualWarnings.filter((w) => w.is_published).map(normaliseManualWarning);
  const { active: manualActive, upcoming: manualUpcoming, past: manualPast } = classifyManualWarnings(normalisedManual, now);

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
  const mergedPast = [...pastWarnings, ...manualPast];
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
    /* The archive is a third tab rather than a modal. "Past warnings" used to
       open a full-screen dialog over the page — a different surface, with its
       own search, its own filters and its own idea of what a warning card
       looks like, for something that is simply the same panel at an earlier
       date. In the tab strip it is one click from the warnings in force and
       keeps the section's own furniture. */
    { id: 'archive', label: 'Archive', rows: [], archive: true },
  ].filter(Boolean);
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

          {/* The archive renders OUTSIDE the AnimatePresence below, not as one
              of its branches. That block is `mode="wait"`, which holds the new
              child back until the outgoing one has finished leaving — and the
              outgoing one here is the warnings spinner, which stays mounted for
              as long as the live warnings feed is loading. The archive is a
              different feed with nothing to wait for, so sharing a presence
              with the spinner just meant it never got to mount. */}
          {currentTab.archive && <WarningsArchive mapUrl={warningMapUrl} />}

          <AnimatePresence mode="wait">
            {currentTab.archive ? null : loadingWarnings ? (
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
                      mapUrl={warningMapUrl} isOwner={isOwner} onDelete={deleteManualWarning} />
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
            {/* No "Past warnings" button: the Archive tab at the top of this
                panel is the same destination, and a second control that only
                switched tabs was just a longer way of pressing it. */}
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
          <SectionHeader eyebrow="Observed" title="Rain radar" />
          {/* The radar brings its own furniture and its own dark ground, so the
              pane gives it an edge and a shadow and otherwise stays out of it. */}
          <Pane pad={false}>
            <WindyRadarEmbed />
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
