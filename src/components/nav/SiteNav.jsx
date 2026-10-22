import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home, MapPin, Database, CloudLightning, Layers, Zap,
  Archive, BarChart3, Target,
  Newspaper, Mail, Settings as SettingsIcon, CreditCard, ShieldAlert,
  ChevronDown, Menu, X, Radar, Sun, Moon,
} from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import { useLogo } from '@/components/MobileHeaderLogo';

/**
 * Site-wide navigation: a grouped top bar with mega-menu panels on desktop,
 * and a full-screen grouped sheet on mobile.
 *
 * This exists because navigation used to be per-page — SectionNavigation drew
 * its own menu on Home, TCMHamburger drew another on the TCM pages,
 * and Layout's own HamburgerMenu was dead code that never rendered. Worse, the
 * Home menu mixed *section jumps* (Active Warnings, Live Radar — anchors on the
 * current page) with *page links* (Model Data, Graphic Studio), so every
 * new page crowded out the scroll anchors.
 *
 * The split is the point: this component moves you between pages, and
 * SectionNavigation keeps doing what it is good at — moving you around within
 * one. Adding a page means adding a line to GROUPS, and the group it belongs to
 * absorbs it without the bar growing.
 *
 * Not rendered on /AdminSettings, which runs its own tabbed chrome.
 */

/* ── the map of the site ────────────────────────────────────────────────────
 * `blurb` is what makes a mega-menu worth having over a flat list: a visitor
 * can tell TCM Outlooks from Weather Patterns without clicking both. Each one
 * says what you will find on the page and where it comes from, in a line or
 * two — and has to be kept true when the page changes: several had drifted
 * (Model Data has not been "UKMO, UKV and ECMWF" since it moved to five
 * models; Lightning is worldwide, recorded round the clock, with AI warnings).
 * `unavailable` dims an entry and badges it "Issues", for a page that is
 * reachable but known to be showing bad data. Nothing carries it at the
 * moment — Lightning Map and TCM Outlooks did, and no longer do.
 */
const GROUPS = [
  {
    id: 'forecast',
    label: 'Forecast',
    items: [
      { label: 'Home', path: '/', icon: Home, blurb: 'Warnings, rain radar, live lightning and the weather around the world' },
      { label: 'Location Weather', path: '/LocationWeather', icon: MapPin, blurb: 'Hour-by-hour forecast for anywhere in the UK and Ireland, from the Met Office UKV' },
      { label: 'Model Data', path: '/ModelData', icon: Database, blurb: 'Maps from UKV, Met Office Global, ECMWF and GFS, plus live radar and satellite' },
      { label: 'Lightning', path: '/Lightning', icon: CloudLightning, blurb: 'Live strikes worldwide, past days to replay, and AI lightning warnings' },
      { label: 'TCM Outlooks', path: '/TCMOutlooks', icon: Zap, blurb: 'Where thunderstorms are likely in the coming days, from our TCM model' },
      { label: 'Weather Patterns', path: '/WeatherPatterns', icon: Layers, blurb: 'The three ways each of the next two weeks could go, with the chance of each' },
      { label: 'Weather Scenarios', path: '/WeatherScenarios', icon: Radar, blurb: 'A library of the weather the UK can get, month by month and region by region' },
    ],
  },
  {
    id: 'graphics',
    label: 'Graphics',
    /* The graphics in force are the first thing on the home page, so the menu has no shortcut to
       them; the past ones and the public Graphic Studio are here. (The Graphics page is gone:
       graphics are posted from the home page and made in the admin Graphic Studio.) */
    items: [
      { label: 'Archive', path: '/MyWeatherArchive', icon: Archive, blurb: 'Every graphic we have issued, to look back on once it has ended' },
      { label: 'Graphic Studio', path: '/GraphicStudio', icon: Zap, blurb: 'Make your own thunderstorm, snow and wind outlook graphics' },
    ],
  },
  {
    id: 'verification',
    label: 'Verification',
    items: [
      { label: 'Forecast Verification', path: '/ForecastVerification', icon: BarChart3, blurb: 'Our forecast graphics with the lightning that followed drawn on top' },
      { label: 'TCM Verification', path: '/TCMVerification', icon: Target, blurb: 'Each day’s TCM NOVA lightning risk against the lightning that came' },
      { label: 'TCM Archive', path: '/TCMArchive', icon: Archive, blurb: 'Every TCM NOVA run over a day old: the Main Run and the Hyper-Short' },
    ],
  },
  {
    id: 'news',
    label: 'News',
    items: [
      { label: 'News', path: '/News', icon: Newspaper, blurb: 'Weather stories and analysis for the UK and Ireland' },
      { label: 'Newsletter', path: '/NewsletterSignup', icon: Mail, blurb: 'Free weekly storm outlooks, model reports and high-risk alerts by email' },
    ],
  },
];

/** Account lives apart from the content groups, on the right of the bar. */
const ACCOUNT_ITEMS = [
  { label: 'Settings', path: '/Settings', icon: SettingsIcon, blurb: 'Units, language and your account' },
  { label: 'Subscription', path: '/Subscription', icon: CreditCard, blurb: 'Plans, what each one includes, and API credits' },
  { label: 'Admin', path: '/AdminSettings', icon: ShieldAlert, blurb: 'Run the site: warnings, graphics, news and settings', adminOnly: true },
];

function visible(items, { isAdmin, isBeta, isAuthenticated }) {
  return items.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.betaOnly && !isBeta && !isAdmin) return false;
    if (item.authOnly && !isAuthenticated) return false;
    return true;
  });
}

const isActivePath = (pathname, path) =>
  path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);

/* ── one link, shared by the desktop panel and the mobile sheet ──────────── */

function NavLink({ item, isDark, active, onNavigate }) {
  const Icon = item.icon;
  const muted = item.unavailable;

  return (
    <Link
      to={item.path}
      onClick={onNavigate}
      title={item.note || undefined}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 11,
        padding: '10px 12px',
        borderRadius: 10,
        textDecoration: 'none',
        background: active ? (isDark ? 'rgba(56,189,248,0.10)' : 'rgba(2,132,199,0.07)') : 'transparent',
        transition: 'background 120ms ease',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = isDark ? 'rgba(148,163,184,0.10)' : 'rgba(15,23,42,0.04)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <Icon
        size={17}
        style={{
          flexShrink: 0,
          marginTop: 1,
          color: active ? (isDark ? '#38bdf8' : '#0284c7') : isDark ? '#64748b' : '#94a3b8',
          opacity: muted ? 0.55 : 1,
        }}
      />
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 13.5,
            fontWeight: active ? 700 : 600,
            color: active ? (isDark ? '#38bdf8' : '#0284c7') : isDark ? '#e2e8f0' : '#1e293b',
            opacity: muted ? 0.7 : 1,
          }}
        >
          {item.label}
          {muted && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                padding: '2px 6px',
                borderRadius: 999,
                color: isDark ? '#fbbf24' : '#b45309',
                background: isDark ? 'rgba(251,191,36,0.13)' : 'rgba(180,83,9,0.10)',
                whiteSpace: 'nowrap',
              }}
            >
              Issues
            </span>
          )}
        </span>
        {item.blurb && (
          /* A shade lighter (dark) and darker (light) than it was: slate-500 on the dark panel
             and slate-400 on white were both too faint to read comfortably at this size. */
          <span
            style={{
              display: 'block',
              marginTop: 3,
              fontSize: 12,
              lineHeight: 1.4,
              color: isDark ? '#94a3b8' : '#64748b',
            }}
          >
            {item.blurb}
          </span>
        )}
      </span>
    </Link>
  );
}

/* ── desktop ────────────────────────────────────────────────────────────── */

function DesktopBar({ roles, siteName, logoUrl }) {
  const { isDark, toggleTheme } = useTheme();
  const location = useLocation();
  const [openId, setOpenId] = useState(null);
  const barRef = useRef(null);
  const closeTimer = useRef(null);

  const close = useCallback(() => setOpenId(null), []);

  // Close on route change, Escape, or a click outside the bar.
  useEffect(close, [location.pathname, close]);

  useEffect(() => {
    if (!openId) return undefined;
    const onKey = (e) => e.key === 'Escape' && close();
    const onClick = (e) => {
      if (barRef.current && !barRef.current.contains(e.target)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [openId, close]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const groups = GROUPS.map((g) => ({ ...g, items: visible(g.items, roles) })).filter((g) => g.items.length);
  const account = visible(ACCOUNT_ITEMS, roles);
  const openGroup = groups.find((g) => g.id === openId) || (openId === 'account' ? { id: 'account', items: account } : null);

  const groupHasActive = (items) => items.some((i) => isActivePath(location.pathname, i.path));

  // Hovering between the button and its panel shouldn't flicker the panel shut.
  const hoverOpen = (id) => {
    clearTimeout(closeTimer.current);
    setOpenId(id);
  };
  const hoverClose = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(close, 140);
  };

  const border = isDark ? '1px solid rgba(255,255,255,0.07)' : '1px solid #e2e8f0';

  return (
    <div
      ref={barRef}
      className="hidden md:block sticky top-0"
      style={{ zIndex: 45 }}
      onMouseLeave={hoverClose}
      onMouseEnter={() => clearTimeout(closeTimer.current)}
    >
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '0 20px',
          height: 56,
          borderBottom: border,
          background: isDark ? 'rgba(11,18,32,0.92)' : 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(14px)',
        }}
      >
        <Link
          to="/"
          style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', marginRight: 14 }}
        >
          {logoUrl && (
            <img
              src={logoUrl}
              alt=""
              style={{ height: 28, width: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
            />
          )}
          <span
            style={{
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: '-0.01em',
              color: isDark ? '#f1f5f9' : '#0f172a',
              whiteSpace: 'nowrap',
            }}
          >
            {siteName}
          </span>
        </Link>

        {groups.map((group) => {
          const isOpen = openId === group.id;
          const hasActive = groupHasActive(group.items);
          return (
            <button
              key={group.id}
              onMouseEnter={() => hoverOpen(group.id)}
              onClick={() => setOpenId(isOpen ? null : group.id)}
              aria-expanded={isOpen}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '7px 12px',
                borderRadius: 9,
                border: 'none',
                cursor: 'pointer',
                fontSize: 13.5,
                fontWeight: hasActive || isOpen ? 700 : 600,
                fontFamily: 'inherit',
                background: isOpen ? (isDark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.05)') : 'transparent',
                color: hasActive || isOpen ? (isDark ? '#38bdf8' : '#0284c7') : isDark ? '#cbd5e1' : '#475569',
              }}
            >
              {group.label}
              <ChevronDown
                size={13}
                style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease', opacity: 0.7 }}
              />
            </button>
          );
        })}

        <div style={{ flex: 1 }} />

        {account.length > 0 && (
          <button
            onMouseEnter={() => hoverOpen('account')}
            onClick={() => setOpenId(openId === 'account' ? null : 'account')}
            aria-expanded={openId === 'account'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '7px 12px',
              borderRadius: 9,
              border: 'none',
              cursor: 'pointer',
              fontSize: 13.5,
              fontWeight: 600,
              fontFamily: 'inherit',
              background: openId === 'account' ? (isDark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.05)') : 'transparent',
              color: isDark ? '#cbd5e1' : '#475569',
            }}
          >
            <SettingsIcon size={15} />
            Account
            <ChevronDown
              size={13}
              style={{ transform: openId === 'account' ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease', opacity: 0.7 }}
            />
          </button>
        )}

        {/* Light/dark, in the bar beside Account rather than floating over the
            bottom-right corner of the page. A fixed circle pinned above the
            content follows you down every page and sits on top of whatever is
            under it — here it is one of the site's controls, in the place the
            site keeps its controls. */}
        <button
          type="button"
          onClick={toggleTheme}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, marginLeft: 2,
            borderRadius: 9, border: 'none', cursor: 'pointer',
            background: 'transparent',
            color: isDark ? '#cbd5e1' : '#475569',
            transition: 'background 150ms ease, color 150ms ease',
          }}
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </nav>

      <AnimatePresence>
        {openGroup && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 56,
              borderBottom: border,
              background: isDark ? 'rgba(11,18,32,0.98)' : 'rgba(255,255,255,0.99)',
              backdropFilter: 'blur(14px)',
              boxShadow: isDark ? '0 18px 40px rgba(0,0,0,0.45)' : '0 18px 40px rgba(15,23,42,0.10)',
            }}
          >
            <div
              style={{
                maxWidth: 1100,
                margin: '0 auto',
                padding: '16px 20px 20px',
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.min(openGroup.items.length, 3)}, minmax(0, 1fr))`,
                gap: 4,
              }}
            >
              {openGroup.items.map((item) => (
                <NavLink
                  key={item.path}
                  item={item}
                  isDark={isDark}
                  active={isActivePath(location.pathname, item.path)}
                  onNavigate={close}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── mobile ─────────────────────────────────────────────────────────────── */

/**
 * A full-screen grouped sheet. The bottom tab bar still handles the four
 * things people open the site for; this is where everything else lives, with
 * its headings intact so the list stays readable as pages are added.
 *
 * Portalled to <body> for the same reason BottomTabBar is: the page-transition
 * wrapper applies a transform, which would otherwise trap `position: fixed`.
 */
function MobileSheet({ roles }) {
  const { isDark } = useTheme();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    // Don't let the page scroll behind the sheet.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const groups = GROUPS.map((g) => ({ ...g, items: visible(g.items, roles) })).filter((g) => g.items.length);
  const account = visible(ACCOUNT_ITEMS, roles);

  return createPortal(
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="md:hidden fixed"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 7px)',
          right: 10,
          zIndex: 41,
          height: 34,
          width: 34,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 9,
          border: 'none',
          cursor: 'pointer',
          background: isDark ? 'rgba(30,41,59,0.85)' : 'rgba(241,245,249,0.9)',
          color: isDark ? '#cbd5e1' : '#475569',
          backdropFilter: 'blur(8px)',
        }}
      >
        <Menu size={19} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="md:hidden fixed inset-0"
            style={{ zIndex: 60, background: isDark ? '#0b1220' : '#fff', overflowY: 'auto' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <div
              style={{
                position: 'sticky',
                top: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)',
                borderBottom: isDark ? '1px solid rgba(255,255,255,0.07)' : '1px solid #e2e8f0',
                background: isDark ? '#0b1220' : '#fff',
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: isDark ? '#38bdf8' : '#0284c7',
                }}
              >
                Menu
              </span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  color: isDark ? '#64748b' : '#94a3b8',
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '8px 10px 40px' }}>
              {[...groups, ...(account.length ? [{ id: 'account', label: 'Account', items: account }] : [])].map(
                (group) => (
                  <div key={group.id} style={{ marginBottom: 14 }}>
                    <div
                      style={{
                        padding: '10px 12px 6px',
                        fontSize: 10.5,
                        fontWeight: 800,
                        letterSpacing: '0.11em',
                        textTransform: 'uppercase',
                        color: isDark ? '#64748b' : '#94a3b8',
                      }}
                    >
                      {group.label}
                    </div>
                    {group.items.map((item) => (
                      <NavLink
                        key={item.path}
                        item={item}
                        isDark={isDark}
                        active={isActivePath(location.pathname, item.path)}
                        onNavigate={() => setOpen(false)}
                      />
                    ))}
                  </div>
                )
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body
  );
}

/* ── entry point ────────────────────────────────────────────────────────── */

export default function SiteNav({ userRole, isAuthenticated, siteName = 'MyWeatherUK' }) {
  const logoUrl = useLogo();
  const roles = {
    isAdmin: userRole === 'admin',
    isBeta: userRole === 'beta_tester',
    isAuthenticated: Boolean(isAuthenticated),
  };

  return (
    <>
      <DesktopBar roles={roles} siteName={siteName} logoUrl={logoUrl} />
      <MobileSheet roles={roles} />
    </>
  );
}
