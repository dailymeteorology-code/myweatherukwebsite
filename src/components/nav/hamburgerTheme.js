/* ════════════════════════════════════════════════════════════════════════════
   hamburgerTheme.js — single source of truth for every slide-out hamburger menu
   on the site (home SectionNavigation, TCM Outlooks, TCM Lightning). Import
   hamburgerPalette() so all menus share identical light/dark styling & UX.

   hamburgerPalette(isDark): isDark=true → dark palette, false → light palette.
   (For the TCM pages, which track their own `lightMode`, call hamburgerPalette(!lightMode).)
   ════════════════════════════════════════════════════════════════════════════ */
export function hamburgerPalette(isDark) {
  return isDark ? {
    backdrop: 'rgba(2,6,15,0.72)',
    panelBg: 'linear-gradient(180deg, #0a1020 0%, #0d1526 55%, #0a1020 100%)',
    panelBorder: 'rgba(255,255,255,0.07)',
    badgeBg: '#0d1526',
    glowA: 'rgba(56,189,248,0.08)', glowB: 'rgba(167,139,250,0.07)',
    headerBorder: 'rgba(255,255,255,0.06)',
    textPrimary: '#f1f5f9', textSecondary: '#94a3b8', textMuted: 'rgba(148,163,184,0.55)', textFaint: '#64748b',
    lockedIcon: '#475569',
    iconTileBg: 'rgba(255,255,255,0.05)', iconTileBorder: 'rgba(255,255,255,0.08)',
    hoverBg: 'rgba(255,255,255,0.045)',
    divider: 'rgba(255,255,255,0.07)', dividerLabel: 'rgba(148,163,184,0.42)',
    headingGrad: 'linear-gradient(135deg, #f1f5f9 0%, #93c5fd 100%)',
    btnBg: 'rgba(15,23,42,0.8)', btnBgOpen: 'rgba(15,23,42,0.96)',
    btnBorder: 'rgba(255,255,255,0.1)', btnBorderOpen: 'rgba(56,189,248,0.4)',
    btnIcon: '#94a3b8', scrollThumb: 'rgba(148,163,184,0.25)',
  } : {
    backdrop: 'rgba(15,23,42,0.38)',
    panelBg: 'linear-gradient(180deg, #ffffff 0%, #f3f8ff 55%, #eaf1fb 100%)',
    panelBorder: 'rgba(15,23,42,0.10)',
    badgeBg: '#ffffff',
    glowA: 'rgba(56,189,248,0.14)', glowB: 'rgba(167,139,250,0.1)',
    headerBorder: 'rgba(15,23,42,0.08)',
    textPrimary: '#0f172a', textSecondary: '#475569', textMuted: 'rgba(71,85,105,0.7)', textFaint: '#64748b',
    lockedIcon: '#94a3b8',
    iconTileBg: 'rgba(15,23,42,0.045)', iconTileBorder: 'rgba(15,23,42,0.1)',
    hoverBg: 'rgba(15,23,42,0.05)',
    divider: 'rgba(15,23,42,0.1)', dividerLabel: 'rgba(71,85,105,0.6)',
    headingGrad: 'linear-gradient(135deg, #0f172a 0%, #0369a1 100%)',
    btnBg: 'rgba(255,255,255,0.86)', btnBgOpen: 'rgba(255,255,255,0.98)',
    btnBorder: 'rgba(15,23,42,0.12)', btnBorderOpen: 'rgba(56,189,248,0.5)',
    btnIcon: '#475569', scrollThumb: 'rgba(15,23,42,0.2)',
  };
}
