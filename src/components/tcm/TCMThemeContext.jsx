import { createContext, useContext } from 'react';

export const THEME_TOKENS = {
  light: {
    // Soft aurora daylight — cool dawn gradient with subtle sky glows
    pageBg: 'radial-gradient(1100px 640px at 12% -8%, rgba(99,102,241,0.10) 0%, transparent 55%), radial-gradient(900px 600px at 92% 4%, rgba(56,189,248,0.10) 0%, transparent 55%), linear-gradient(165deg, #eef2fb 0%, #f7faff 38%, #f0f5ff 70%, #f4f2ff 100%)',
    cardBg: 'linear-gradient(155deg, rgba(255,255,255,0.86) 0%, rgba(247,250,255,0.70) 100%)',
    cardBorder: 'rgba(99,130,200,0.20)',
    cardShadow: '0 10px 38px rgba(30,41,90,0.10), 0 1px 0 rgba(255,255,255,0.9), inset 0 1px 0 rgba(255,255,255,0.80)',
    cardHighlight: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.45), rgba(56,189,248,0.35), transparent)',
    accentGlow: 'rgba(99,102,241,0.18)',
    textPrimary: '#0c1530',
    textSecondary: '#48597a',
    textMuted: '#8a98b5',
    inputBorder: 'rgba(99,130,200,0.26)',
    titleCardBg: 'rgba(255,255,255,0.94)',
    titleCardBorder: 'rgba(99,130,200,0.30)',
    titleCardText: '#0c1530',
    titleCardSub: '#48597a',
  },
  dark: {
    // Aurora Glass — deep storm backdrop with cyan/violet aurora bleed
    pageBg: 'radial-gradient(1200px 700px at 15% -5%, rgba(56,189,248,0.10) 0%, transparent 55%), radial-gradient(1000px 650px at 95% 8%, rgba(167,139,250,0.12) 0%, transparent 55%), linear-gradient(165deg, #050912 0%, #0a1124 38%, #0c1730 68%, #100a26 100%)',
    cardBg: 'linear-gradient(150deg, rgba(40,56,84,0.46) 0%, rgba(16,24,46,0.40) 55%, rgba(20,14,40,0.40) 100%)',
    cardBorder: 'rgba(120,160,230,0.18)',
    cardShadow: '0 16px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(56,189,248,0.04), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 32px rgba(56,189,248,0.025)',
    textPrimary: '#f1f5f9',
    textSecondary: '#a5b1c7',
    textMuted: '#6b7a93',
    inputBorder: 'rgba(120,160,230,0.16)',
    cardHighlight: 'linear-gradient(90deg, transparent, rgba(56,189,248,0.55), rgba(167,139,250,0.55), transparent)',
    accentGlow: 'rgba(56,189,248,0.20)',
    titleCardBg: 'linear-gradient(150deg, rgba(20,30,54,0.88) 0%, rgba(14,20,40,0.84) 100%)',
    titleCardBorder: 'rgba(120,160,230,0.28)',
    titleCardText: '#f1f5f9',
    titleCardSub: '#a5b1c7',
  },
};

export const TCMThemeContext = createContext({ lightMode: false, toggle: () => {}, t: THEME_TOKENS.dark });
export const useTCMTheme = () => useContext(TCMThemeContext);