import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Menu, X, AlertTriangle, Clock, CloudSun, Radar,
  LogIn, LogOut, UserPlus, ShieldAlert, MapPin,
  CloudLightning, Lock, Sun, Moon, ChevronRight, Newspaper, Database, Zap } from
'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from './ThemeContext';
import { Link, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useLanguage } from '@/lib/LanguageContext';
import { hamburgerPalette } from '@/components/nav/hamburgerTheme';

/* ─── Theme palettes ──────────────────────────────────────────── */
function palette(isDark) {
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

/* ─── Upcoming-warning composite icon — warning triangle + clock badge (top-left) ─ */
function UpcomingWarningIcon({ style = {} }) {
  const { width = 15, height = 15, color = 'currentColor' } = style;
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width, height, flexShrink: 0 }}>
      <AlertTriangle style={{ width: '100%', height: '100%', color }} />
      <Clock style={{ position: 'absolute', top: -3, left: -3, width: '64%', height: '64%', color: '#60a5fa', background: 'var(--nav-badge-bg, #0d1526)', borderRadius: '50%', padding: 1, boxSizing: 'border-box' }} />
    </span>);
}

/* ─── Section definitions ─────────────────────────────────────── */
/* Quick Travel — the primary weather destinations.

   Entries WITHOUT an `href` are on-page anchors and are listed top-to-bottom to
   match the Home page. Entries WITH one are whole pages; NavItem wraps those in
   a Link instead of calling scrollTo. Location Weather leads because "what is
   it doing where I am" is the most direct thing a reader comes here for, and it
   is a destination rather than a scroll target, so it does not disturb the
   ordering of the anchors below it. */
const QUICK_TRAVEL_DEFS = [
{ id: 'locationWeather', labelKey: 'locationWeather', icon: MapPin, color: '#22d3ee', accent: 'rgba(34,211,238,0.12)', href: '/LocationWeather' },
{ id: 'forecasts', labelKey: 'myWeatherGraphics', icon: CloudSun, color: '#38bdf8', accent: 'rgba(56,189,248,0.12)' },
{ id: 'activeWarnings', labelKey: 'activeWarnings', icon: AlertTriangle, color: '#ef4444', accent: 'rgba(239,68,68,0.12)' },
{ id: 'upcomingWarnings', labelKey: 'upcomingWarnings', icon: UpcomingWarningIcon, color: '#f97316', accent: 'rgba(249,115,22,0.12)' },
{ id: 'liveRadar', labelKey: 'liveRadar', icon: Radar, color: '#34d399', accent: 'rgba(52,211,153,0.12)' },
{ id: 'modelData', label: 'Model Data', icon: Database, color: '#818cf8', accent: 'rgba(129,140,248,0.12)', href: '/ModelData' },
{ id: 'thunderstormStudio', label: 'Thunderstorm Studio', icon: Zap, color: '#facc15', accent: 'rgba(250,204,21,0.12)', href: '/ThunderstormStudio' }];

/* TCM — dedicated section rendered under its own logo header */
const TCM_DEFS = [
{ id: 'tcmLightning', labelKey: 'tcmLightning', icon: CloudLightning, color: '#a78bfa', accent: 'rgba(167,139,250,0.12)', href: '/Lightning', unavailable: true },
{ id: 'tcmOutlooks', labelKey: 'tcmOutlooks', icon: CloudLightning, color: '#facc15', accent: 'rgba(250,204,21,0.12)', href: '/TCMOutlooks', unavailable: true, note: 'Temporarily Unavailable due to data issues and data being shown incorrectly' }];

/* ─── Single nav item ─────────────────────────────────────────── */
function NavItem({ section, index, locked, onClick, isActive, p }) {
  const Icon = section.icon;
  const [hovered, setHovered] = useState(false);
  const on = (hovered || isActive) && !locked;

  const content =
  <motion.div
    initial={{ opacity: 0, x: -24 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay: 0.06 + index * 0.05, duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
    onHoverStart={() => setHovered(true)}
    onHoverEnd={() => setHovered(false)}
    style={{ position: 'relative', marginBottom: 3 }}>

      {/* Active / hover background */}
      <motion.div
        animate={{ opacity: on ? 1 : 0, scaleX: on ? 1 : 0.9 }}
        transition={{ duration: 0.18 }}
        style={{
          position: 'absolute', inset: 0, borderRadius: 14,
          background: section.accent, border: `1px solid ${section.color}2e`,
          transformOrigin: 'left', pointerEvents: 'none',
        }} />

      {/* Left accent bar */}
      <motion.div
        animate={{ scaleY: on ? 1 : 0, opacity: on ? 1 : 0 }}
        transition={{ duration: 0.18 }}
        style={{ position: 'absolute', left: 0, top: '18%', bottom: '18%', width: 3, borderRadius: 99, background: section.color }} />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 13,
        padding: '11px 14px 11px 18px',
        cursor: locked ? 'not-allowed' : 'pointer', userSelect: 'none',
        opacity: locked && !section.unavailable ? 0.42 : 1, position: 'relative',
      }}>
        {/* Icon tile */}
        <motion.div
          animate={{ scale: on ? 1.1 : 1, rotate: on ? -5 : 0 }}
          transition={{ duration: 0.2 }}
          style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: on ? section.accent : p.iconTileBg,
            border: `1px solid ${on ? section.color + '45' : p.iconTileBorder}`,
            transition: 'background 0.2s, border-color 0.2s',
          }}>
          <Icon style={{ width: 15, height: 15, color: locked ? p.lockedIcon : section.color }} />
        </motion.div>

        <span style={{
          fontSize: '0.85rem', fontWeight: 600, flex: 1,
          color: locked ? p.textSecondary : (isActive ? section.color : (hovered ? p.textPrimary : p.textSecondary)),
          letterSpacing: '-0.01em', transition: 'color 0.2s', fontFamily: "'DM Sans', system-ui, sans-serif",
        }}>
          {section.label}
        </span>

        {locked ?
          <span style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: section.unavailable ? '0.56rem' : '0.62rem', fontWeight: 700,
            letterSpacing: '0.04em', whiteSpace: 'nowrap', flexShrink: 0,
            color: section.unavailable ? '#fb923c' : '#f97316',
            background: 'rgba(249,115,22,0.16)', border: '1px solid rgba(249,115,22,0.5)',
            padding: '2px 8px', borderRadius: 99,
            textTransform: section.unavailable ? 'none' : 'uppercase',
          }}>
            <Lock style={{ width: 9, height: 9 }} /> {section.unavailable ? 'Temporarily unavailable' : 'Soon'}
          </span> :
          <motion.div animate={{ x: on ? 3 : 0, opacity: on ? 1 : 0.35 }} transition={{ duration: 0.18 }}>
            <ChevronRight style={{ width: 14, height: 14, color: isActive || hovered ? section.color : p.textFaint }} />
          </motion.div>}
      </div>
    </motion.div>;

  if (section.href && !locked) {
    return <Link to={section.href} onClick={onClick} style={{ textDecoration: 'none', display: 'block' }}>{content}</Link>;
  }
  return <div onClick={() => !locked && onClick(section.id)}>{content}</div>;
}

/* ─── Utility nav item (auth, theme, admin) ───────────────────── */
function UtilItem({ icon: Icon, label, onClick, color = '#64748b', delay = 0, p }) {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.button
      initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      onHoverStart={() => setHovered(true)} onHoverEnd={() => setHovered(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 13,
        padding: '10px 14px 10px 18px', borderRadius: 12,
        background: hovered ? p.hoverBg : 'transparent',
        border: 'none', cursor: 'pointer', textAlign: 'left',
        transition: 'background 0.18s', fontFamily: "'DM Sans', system-ui, sans-serif",
      }}>
      <div style={{
        width: 32, height: 32, borderRadius: 9, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: hovered ? `${color}1f` : p.iconTileBg,
        border: `1px solid ${hovered ? color + '3a' : p.iconTileBorder}`, transition: 'all 0.18s',
      }}>
        <Icon style={{ width: 14, height: 14, color: hovered ? color : p.textFaint, transition: 'color 0.18s' }} />
      </div>
      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: hovered ? p.textPrimary : p.textSecondary, transition: 'color 0.18s', letterSpacing: '-0.01em' }}>
        {label}
      </span>
    </motion.button>);
}

/* ─── Divider ─────────────────────────────────────────────────── */
function Divider({ label, p }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px 6px', margin: '2px 0' }}>
      {label && <span style={{ fontSize: '0.6rem', fontWeight: 800, color: p.dividerLabel, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{label}</span>}
      <div style={{ flex: 1, height: 1, background: p.divider }} />
    </div>);
}

/* ─── Main component ──────────────────────────────────────────── */
export default function SectionNavigation() {
  const [isOpen, setIsOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [authChecked, setChecked] = useState(false);
  const { isDark, toggleTheme } = useTheme();
  const { t } = useLanguage();
  const { pathname } = useLocation();
  const p = hamburgerPalette(isDark);

  // `label` wins where an entry has no translation key yet, so a new tab reads
  // properly instead of showing its raw key.
  const quickTravel = QUICK_TRAVEL_DEFS.map(s => ({ ...s, label: s.label ?? t(s.labelKey) }));
  const tcmSections = TCM_DEFS.map(s => ({ ...s, label: t(s.labelKey) }));

  const { data: menuConfigs = [] } = useQuery({
    queryKey: ['menuItemConfigs'],
    queryFn: () => base44.entities.MenuItemConfig.list(),
  });
  const { data: siteSettingsList = [] } = useQuery({
    queryKey: ['siteSettingsLogo'],
    queryFn: () => base44.entities.SiteSettings.list(),
  });
  const tcmLogoUrl = siteSettingsList?.[0]?.tcm_logo_url || '';
  const siteLogoUrl = siteSettingsList?.[0]?.logo_url || '';

  const isLocked = (id) => menuConfigs.find((m) => m.section_id === id)?.is_coming_soon ?? false;

  useEffect(() => {
    base44.auth.me().then((u) => { setUser(u); setChecked(true); }).catch(() => setChecked(true));
  }, []);

  // Close on escape + lock body scroll while open
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setIsOpen(false);
  };
  const close = () => setIsOpen(false);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@500&display=swap');
        @keyframes nav-aurora { 0%{background-position:0% 50%} 100%{background-position:200% 50%} }
        .nav-scroll::-webkit-scrollbar { width: 5px; }
        .nav-scroll::-webkit-scrollbar-track { background: transparent; }
        .nav-scroll::-webkit-scrollbar-thumb { background: var(--nav-scroll-thumb); border-radius: 99px; }
      `}</style>

      {/* ── Hamburger button ─────────────────────────────────── */}
      <motion.button
        onClick={() => setIsOpen((o) => !o)}
        aria-label={isOpen ? 'Close menu' : 'Open menu'}
        whileTap={{ scale: 0.9 }}
        style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top, 0px) + 58px)', left: 16, zIndex: 50,
          width: 44, height: 44, borderRadius: 13,
          background: isOpen ? p.btnBgOpen : p.btnBg,
          border: `1px solid ${isOpen ? p.btnBorderOpen : p.btnBorder}`,
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          boxShadow: isOpen
            ? '0 0 0 1px rgba(56,189,248,0.15), 0 10px 34px rgba(0,0,0,0.32)'
            : '0 4px 22px rgba(0,0,0,0.22)',
          transition: 'background 0.25s, border-color 0.25s, box-shadow 0.25s',
        }}
        className="md:!top-5 md:!left-5"
      >
        <AnimatePresence mode="wait">
          {isOpen ?
            <motion.div key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.18 }}>
              <X style={{ width: 19, height: 19, color: '#38bdf8' }} />
            </motion.div> :
            <motion.div key="m" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.18 }}>
              <Menu style={{ width: 19, height: 19, color: p.btnIcon }} />
            </motion.div>}
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
        {isOpen &&
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }} onClick={close}
            style={{ position: 'fixed', inset: 0, zIndex: 40, background: p.backdrop, backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }} />

          {/* Sidebar panel */}
          <motion.div
            className="nav-scroll"
            initial={{ x: -336, opacity: 0.4 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -336, opacity: 0 }}
            transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: 'fixed', left: 0, top: 0, bottom: 0, width: 300, zIndex: 50,
              background: p.panelBg, borderRight: `1px solid ${p.panelBorder}`,
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: '8px 0 40px rgba(0,0,0,0.22)',
              '--nav-badge-bg': p.badgeBg, '--nav-scroll-thumb': p.scrollThumb,
            }}>

            {/* Ambient glows */}
            <div style={{ position: 'absolute', top: -60, left: -40, width: 280, height: 280, borderRadius: '50%', background: `radial-gradient(circle, ${p.glowA} 0%, transparent 70%)`, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: -60, right: -40, width: 220, height: 220, borderRadius: '50%', background: `radial-gradient(circle, ${p.glowB} 0%, transparent 70%)`, pointerEvents: 'none' }} />

            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.32 }}
              style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 20px) 20px 18px', borderBottom: `1px solid ${p.headerBorder}`, position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                {siteLogoUrl ?
                  <img src={siteLogoUrl} alt="" style={{ width: 38, height: 38, borderRadius: 10, objectFit: 'contain', flexShrink: 0, background: p.iconTileBg, border: `1px solid ${p.iconTileBorder}`, padding: 3 }} /> :
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg, rgba(56,189,248,0.22), rgba(167,139,250,0.22))', border: '1px solid rgba(56,189,248,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <CloudLightning style={{ width: 18, height: 18, color: '#38bdf8' }} />
                  </div>}
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: '1rem', fontWeight: 800, letterSpacing: '-0.02em', fontFamily: "'DM Sans', system-ui, sans-serif", background: p.headingGrad, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    Navigation
                  </p>
                  <p style={{ margin: 0, fontSize: '0.6rem', fontWeight: 700, color: p.textMuted, letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: "'DM Mono', monospace" }}>
                    MyWeatherUK
                  </p>
                </div>
              </div>
            </motion.div>

            {/* Scrollable body */}
            <div className="nav-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 16px' }}>

              {/* Quick Travel */}
              <Divider label="Quick Travel" p={p} />
              <div style={{ marginBottom: 2 }}>
                {quickTravel.map((section, i) =>
                  <NavItem key={section.id} section={section} index={i}
                    locked={isLocked(section.id) || !!section.unavailable}
                    onClick={scrollTo} isActive={false} p={p} />)}
              </div>

              {/* TCM — logo header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 18px 6px' }}>
                {tcmLogoUrl ?
                  <img src={tcmLogoUrl} alt="TCM" style={{ height: 26, width: 'auto', maxWidth: 52, objectFit: 'contain', flexShrink: 0, filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.45))' }} /> :
                  <CloudLightning style={{ width: 16, height: 16, color: '#a78bfa', flexShrink: 0 }} />}
                <span style={{ fontSize: '0.6rem', fontWeight: 800, color: p.dividerLabel, letterSpacing: '0.14em', textTransform: 'uppercase' }}>TCM</span>
                <div style={{ flex: 1, height: 1, background: p.divider }} />
              </div>
              <div style={{ marginBottom: 2 }}>
                {tcmSections.map((section, i) =>
                  <React.Fragment key={section.id}>
                    <NavItem section={section} index={quickTravel.length + i}
                      locked={isLocked(section.id) || !!section.unavailable}
                      onClick={scrollTo} isActive={pathname === section.href} p={p} />
                    {section.note &&
                      <p style={{ margin: '-2px 0 9px', padding: '0 18px 0 66px', fontSize: '0.6rem', lineHeight: 1.4, color: '#f59e0b', fontFamily: "'DM Sans', system-ui, sans-serif" }}>
                        {section.note}
                      </p>}
                  </React.Fragment>)}
              </div>

              <Divider label="Account" p={p} />

              {authChecked &&
                <div>
                  {user ?
                    <>
                      <motion.div
                        initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.34, duration: 0.3 }}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px 4px' }}>
                        <Link to="/Settings" onClick={close} title="Open Settings" style={{ textDecoration: 'none', flexShrink: 0, borderRadius: '50%' }}>
                          <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg, #38bdf8, #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '0.78rem', fontWeight: 700, color: '#fff', fontFamily: "'DM Sans', system-ui", cursor: 'pointer', border: '2px solid rgba(56,189,248,0.55)', boxShadow: '0 0 10px rgba(56,189,248,0.25)' }}>
                            {user.email?.[0]?.toUpperCase() || '?'}
                          </div>
                        </Link>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: '0.72rem', fontWeight: 700, color: p.textSecondary, fontFamily: "'DM Sans', system-ui", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {user.email}
                          </p>
                          <p style={{ margin: 0, fontSize: '0.6rem', color: p.textMuted, fontFamily: "'DM Mono', monospace", letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                            {user.role || 'member'}
                          </p>
                        </div>
                      </motion.div>
                      <p style={{ margin: '2px 0 6px', padding: '0 18px', fontSize: '0.62rem', lineHeight: 1.45, color: p.textMuted, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
                        Tap your profile icon to open Settings.
                      </p>
                      <UtilItem icon={LogOut} label={t('signOut')} color="#ef4444" delay={0.4} onClick={() => { base44.auth.logout(); close(); }} p={p} />
                    </> :
                    <>
                      <UtilItem icon={LogIn} label={t('signIn')} color="#38bdf8" delay={0.34} onClick={() => { base44.auth.redirectToLogin(); close(); }} p={p} />
                      <UtilItem icon={UserPlus} label={t('signUp')} color="#34d399" delay={0.4} onClick={() => { base44.auth.redirectToLogin(); close(); }} p={p} />
                    </>}
                </div>}

              <Divider label="More" p={p} />

              <motion.div initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.44, duration: 0.3 }}>
                <Link to="/News" onClick={close} style={{ textDecoration: 'none', display: 'block' }}>
                  <UtilItem icon={Newspaper} label="Weather News" color="#38bdf8" delay={0} onClick={() => {}} p={p} />
                </Link>
              </motion.div>

              {user?.role === 'admin' &&
                <motion.div initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.46, duration: 0.3 }}>
                  <Link to="/AdminSettings" onClick={close} style={{ textDecoration: 'none', display: 'block' }}>
                    <UtilItem icon={ShieldAlert} label="Admin Settings" color="#f59e0b" delay={0} onClick={() => {}} p={p} />
                  </Link>
                </motion.div>}

              <motion.div initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.48, duration: 0.3 }}>
                <UtilItem icon={isDark ? Sun : Moon} label={isDark ? t('lightMode') : t('darkMode')} color="#38bdf8" delay={0.5} onClick={toggleTheme} p={p} />
              </motion.div>
            </div>
          </motion.div>
        </>}
      </AnimatePresence>
    </>);
}