import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import SiteDisabled from '@/pages/SiteDisabled';
import RestrictedSiteOverlay from '@/components/RestrictedSiteOverlay';
import AdminSettings from '@/pages/AdminSettings';
import AdminOnlyRoute from '@/components/AdminOnlyRoute';
import TCM from '@/pages/TCM';
import WeatherCriteria from '@/pages/WeatherCriteria';
import WeatherPatterns from '@/pages/WeatherPatterns';
import TCMOutlooks from '@/pages/TCMOutlooks';
import News from '@/pages/News';
import ModelData from '@/pages/ModelData';
import TCMArchive from '@/pages/TCMArchive';
import MyWeatherArchive from '@/pages/MyWeatherArchive';
import WeatherScenarios from '@/pages/WeatherScenarios';
import ForecastVerification from '@/pages/ForecastVerification';
import MyWeatherGraphics from '@/pages/MyWeatherGraphics';
import ThunderstormStudio from '@/pages/ThunderstormStudio';
import LiveStream from '@/pages/LiveStream';
import ModelFeedback from '@/pages/ModelFeedback';
import TCMVerification from '@/pages/TCMVerification';
import NewsletterSignup from '@/pages/NewsletterSignup';
import NewsletterPopup from '@/components/NewsletterPopup';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import { Navigate } from 'react-router-dom';
import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { LanguageProvider } from '@/lib/LanguageContext';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

// ─── Dynamic landing page — reads SiteSettings.landing_page ──────────────
function DynamicLandingPage() {
  const [landingComp, setLandingComp] = useState(() => (
    <LayoutWrapper currentPageName={mainPageKey}><MainPage /></LayoutWrapper>
  ));
  useEffect(() => {
    base44.entities.SiteSettings.list().then(list => {
      const lp = list[0]?.landing_page;
      if (lp && Pages[lp]) {
        const LandingPage = Pages[lp];
        setLandingComp(<LayoutWrapper currentPageName={lp}><LandingPage /></LayoutWrapper>);
      } else {
        setLandingComp(<LayoutWrapper currentPageName={mainPageKey}><MainPage /></LayoutWrapper>);
      }
    }).catch(() => {});
  }, []);
  return landingComp;
}

const LayoutWrapper = ({ children, currentPageName }) => Layout
  ? <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

// ─── Route order — determines slide direction ─────────────────────────────
const ROUTE_ORDER = ['/', '/Home', '/LocationWeather', '/News', '/Graphics', '/Lightning', '/TCMOutlooks', '/WeatherPatterns',
  '/TCMArchive', '/MyWeatherArchive', '/WeatherCriteria', '/ForecastVerification', '/WeatherScenarios', '/Settings', '/AdminSettings'];
function routeIndex(pathname) {
  const idx = ROUTE_ORDER.findIndex(r => pathname === r || pathname.startsWith(r + '/'));
  return idx === -1 ? 0 : idx;
}

const PAGE_LABELS = {
  '/': 'Home', '/Home': 'Home', '/News': 'News', '/Lightning': 'Lightning',
  '/TCMOutlooks': 'TCM Outlooks', '/TCMNova': 'TCM NOVA', '/TCMV5': 'TCM NOVA', '/WeatherPatterns': 'TCM Outlooks', '/Graphics': 'Graphics',
  '/Settings': 'Settings', '/AdminSettings': 'Admin',
  '/TCMArchive': 'Archive', '/MyWeatherArchive': 'Archive',
  '/LocationWeather': 'Location', '/WeatherCriteria': 'Criteria', '/ForecastVerification': 'Verification', '/WeatherScenarios': 'Scenarios',
};
function getPageLabel(pathname) {
  if (PAGE_LABELS[pathname]) return PAGE_LABELS[pathname];
  return PAGE_LABELS['/' + pathname.split('/')[1]] || '';
}

// ─── Thin progress bar that sweeps across the top on navigation ───────────
/* NO OVERLAY BETWEEN PAGES, and that is a decision rather than an omission.
   Every route is in the main bundle — there is no chunk to fetch — so a
   navigation is a React re-render and is over in a frame or two. Dropping a
   loading screen in front of that would not cover a wait, it would MANUFACTURE
   one, and the site would feel slower than it is. What a navigation actually
   needs is acknowledgement, which is this: a light running the top edge, in
   the same accent and the same 2px hairline as the boot screen's progress
   track, so the two read as one family. Pages fetching their own data keep
   their own in-place spinners, which is where a real wait belongs. */
function NavProgressBar({ active }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="nav-bar"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.24, ease: 'easeOut' } }}
          transition={{ duration: 0.12 }}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 2, zIndex: 9999, pointerEvents: 'none' }}
        >
          <motion.div
            initial={{ width: '6%' }}
            animate={{ width: '88%' }}
            exit={{ width: '100%', transition: { duration: 0.24, ease: 'easeOut' } }}
            transition={{ duration: 1.6, ease: [0.1, 0.72, 0.28, 1] }}
            style={{
              position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: '0 2px 2px 0',
              background: 'linear-gradient(90deg, #1d74c4, #38bdf8, #7dd3fc)',
              backgroundSize: '220% 100%',
              animation: 'mwuk-progress-shimmer 1.1s linear infinite',
              boxShadow: '0 0 12px rgba(56,189,248,0.8)',
            }}
          >
            {/* Glowing leading edge. */}
            <span style={{ position: 'absolute', right: -2, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, borderRadius: '50%', background: 'radial-gradient(circle, rgba(125,211,252,0.95) 0%, rgba(56,189,248,0.4) 44%, transparent 72%)', pointerEvents: 'none' }} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Page wrapper — handles directional slide + progress bar ─────────────
function PageWrapper({ children }) {
  const location = useLocation();
  const prevIdxRef = useRef(routeIndex(location.pathname));
  const [direction, setDirection] = useState(0);
  const [navigating, setNavigating] = useState(false);
  const timerRef = useRef(null);
  const pageRef = useRef(null);

  useEffect(() => {
    const next = routeIndex(location.pathname);
    setDirection(next >= prevIdxRef.current ? 1 : -1);
    prevIdxRef.current = next;
    setNavigating(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setNavigating(false);
      // Belt and braces: if onAnimationComplete never fires (interrupted
      // transition, reduced-motion), the filter must still not outlive the
      // animation — it would re-anchor every fixed-position modal on the page.
      if (pageRef.current) pageRef.current.style.filter = 'none';
      /* 420ms, down from 550. The bar is acknowledging an instant navigation,
         not covering a load; past about half a second it stops reading as
         "done" and starts reading as "still going". */
    }, 420);
    return () => clearTimeout(timerRef.current);
  }, [location.pathname]);

  const label = getPageLabel(location.pathname);

  /* NO BLUR ON THE PAGE WRAPPER, at any point in the transition.
     A `filter` of anything other than `none` makes this element the containing
     block for every `position: fixed` descendant of the page, so `inset: 0`
     inside a page resolves against the full document box rather than the
     viewport. That is how the Location Weather sky ended up 2323px tall and
     its horizon a page and a half below the fold, and it is the same reason
     modals rendered inside a page were centring halfway down it.

     It used to be cleared imperatively once the enter animation finished (see
     clearPageFilter, kept below as a belt-and-braces backstop). That does not
     hold: Framer owns the style and rewrites `filter: blur(0px)` on every
     subsequent render, and a weather page re-renders every time a fetch lands.
     The only reliable fix is never to put a filter here at all — the fade,
     the slide and the scale carry the transition perfectly well without it. */
  const variants = {
    initial: (dir) => ({ opacity: 0, y: 10, scale: 0.985, x: dir * 8 }),
    animate: { opacity: 1, y: 0, scale: 1, x: 0,
      transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } },
    exit: (dir) => ({ opacity: 0, y: -6, scale: 0.992, x: dir * -6,
      transition: { duration: 0.15, ease: [0.4, 0, 1, 1] } }),
  };

  // Backstop for the containing-block problem described above: nothing sets a
  // filter here any more, but if one ever creeps back in — a variant, a
  // stylesheet, a future effect — this clears it rather than letting every
  // fixed-position element on the page silently mis-resolve.
  const clearPageFilter = (definition) => {
    if (definition === 'animate' && pageRef.current) {
      pageRef.current.style.filter = 'none';
    }
  };

  return (
    <>
      <NavProgressBar active={navigating} />

      {/* Page label flash — appears just below the progress bar */}
      <AnimatePresence>
        {navigating && label && (
          <motion.span
            key={`lbl-${location.pathname}`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{
              position: 'fixed', top: 6, left: '50%', transform: 'translateX(-50%)',
              zIndex: 9998, pointerEvents: 'none',
              /* Archivo, because that is the only face the site loads — the
                 DM Sans this asked for was never there and it was quietly
                 rendering in whatever system-ui resolved to. */
              fontFamily: 'Archivo, system-ui, sans-serif',
              fontSize: 9, fontWeight: 800, letterSpacing: '0.16em',
              textTransform: 'uppercase', color: '#7dd3fc',
              textShadow: '0 0 10px rgba(56,189,248,0.6)',
            }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          ref={pageRef}
          key={location.pathname}
          custom={direction}
          variants={variants}
          initial="initial"
          animate="animate"
          exit="exit"
          onAnimationComplete={clearPageFilter}
          /* `filter` dropped from the hint along with the blur itself — and it
             matters, because a will-change of anything but `auto` creates the
             same containing block a real filter would. */
          style={{ willChange: navigating ? 'transform, opacity' : 'auto' }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

// ─── Loading screen ───────────────────────────────────────────────────────
/* THE WHOLE THING IS THE WORDMARK, lit. What came before ran a radar sweep,
   three ripple rings, three orbiting dots, a pulsing core, a striking bolt, a
   full-screen lightning flash and a progress bar simultaneously — eight ideas
   inside two seconds, which is busy rather than impressive, and none of it said
   whose site you were waiting for.

   Now: isobars drifting behind, a single glint crossing the name, one light
   running the progress line. The keyframes live in index.css. */

/** The theme, read the way ThemeContext itself reads it.
 *
 *  Deliberately from storage and not from the `dark` class: this paints before
 *  ThemeContext's effect has run, so reading the class would show a dark loader
 *  to someone on the light theme for the first frame and then snap. */
function loaderIsDark() {
  try {
    const saved = localStorage.getItem('theme');
    return !(saved === 'false' || saved === 'light');
  } catch {
    return true;
  }
}

function loaderPalette(isDark) {
  return isDark ? {
    bg: 'radial-gradient(ellipse 80% 62% at 50% 38%, #111d33 0%, #0a1220 55%, #070c16 100%)',
    scrim: 'rgba(7,12,22,0.72)',
    ink: '#eaf2fd',
    accent: '#56b6f5',
    isobar: 'rgba(125,175,235,0.18)',
    glint: 'rgba(255,255,255,0.92)',
    track: 'rgba(255,255,255,0.10)',
    sub: 'rgba(150,172,200,0.72)',
  } : {
    bg: 'radial-gradient(ellipse 80% 62% at 50% 38%, #e9f1fd 0%, #f5f9ff 55%, #ffffff 100%)',
    scrim: 'rgba(245,249,255,0.74)',
    ink: '#0d1726',
    accent: '#1d74c4',
    isobar: 'rgba(29,116,196,0.16)',
    /* Tinted, not white. The dark theme's glint is white because white over
       pale letters reads as a flash of light; the same white over the light
       theme's near-black letters wipes them out instead, which looks like a
       rendering fault rather than a highlight. A blue lift keeps the letters
       legible the whole way through and reads as a reflection crossing them. */
    glint: 'rgba(96,170,240,0.92)',
    track: 'rgba(13,23,38,0.11)',
    sub: 'rgba(71,92,117,0.8)',
  };
}

/** Pressure contours, drifting.
 *
 *  A weather site's loading screen may as well be a weather chart. Each curve
 *  repeats every 40 user units and slides by exactly 40, so the loop returns to
 *  an identical frame and there is no seam; the differing durations are what
 *  separate them into depth rather than one sheet sliding. */
function LoaderIsobars({ colour }) {
  const paths = useMemo(() => {
    const PERIOD = 40;
    return [0, 1, 2, 3, 4, 5].map((i) => {
      const y = 11 + i * 15.5;
      const amp = 3.2 + (i % 3) * 1.6;
      const phase = i * 1.07;
      const pts = [];
      for (let x = -60; x <= 180; x += 4) {
        const yy = y + Math.sin((x / PERIOD) * Math.PI * 2 + phase) * amp;
        pts.push(`${x},${yy.toFixed(2)}`);
      }
      return { d: `M${pts.join(' L')}`, dur: 20 + i * 6 };
    });
  }, []);

  return (
    <svg
      viewBox="0 0 120 100" preserveAspectRatio="none" aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {paths.map((p, i) => (
        <path
          key={i} className="mwuk-isobar" d={p.d} fill="none" stroke={colour}
          strokeWidth="0.5" strokeLinecap="round"
          style={{ animation: `mwuk-isobar ${p.dur}s linear infinite` }} />
      ))}
    </svg>
  );
}

/** The name, with a highlight travelling across the letters.
 *
 *  Two stacked copies: the readable one underneath carrying the two-tone
 *  colour, and an identical copy on top whose fill is a mostly-transparent
 *  gradient clipped to the glyphs. Only the second one animates, so the glint
 *  passes THROUGH the wordmark instead of over it, and "UK" keeps its accent —
 *  which a single clipped gradient could not do. */
function LoaderWordmark({ P, size }) {
  const type = {
    fontFamily: 'Archivo, system-ui, sans-serif',
    fontWeight: 800, fontSize: size, letterSpacing: '-0.035em',
    lineHeight: 1, whiteSpace: 'nowrap',
  };
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span style={{ ...type, color: P.ink }}>
        MyWeather<span style={{ color: P.accent }}>UK</span>
      </span>
      <span
        aria-hidden="true" className="mwuk-glint"
        style={{
          ...type, position: 'absolute', left: 0, top: 0,
          backgroundImage: `linear-gradient(104deg, transparent 43%, ${P.glint} 50%, transparent 57%)`,
          backgroundSize: '260% 100%', backgroundRepeat: 'no-repeat',
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
          animation: 'mwuk-glint 2.9s ease-in-out infinite',
        }}>
        MyWeatherUK
      </span>
    </span>
  );
}

function LoaderTrack({ P, width }) {
  return (
    <div style={{ position: 'relative', width, height: 2, borderRadius: 99, background: P.track, overflow: 'hidden' }}>
      <span
        className="mwuk-runner"
        style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: '38%', borderRadius: 99,
          background: `linear-gradient(90deg, transparent, ${P.accent}, transparent)`,
          animation: 'mwuk-runner 1.45s cubic-bezier(0.45, 0.05, 0.35, 1) infinite',
        }} />
    </div>
  );
}

/**
 * Full-screen loader, shown while auth and settings bootstrap.
 *
 * `compact` renders the same mark smaller and over a translucent scrim rather
 * than an opaque background, for use above a page that is already drawn.
 */
function PageLoader({ compact = false, note }) {
  const isDark = loaderIsDark();
  const P = loaderPalette(isDark);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: compact ? 0.18 : 0.3 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: compact ? 18 : 26,
        background: compact ? P.scrim : P.bg,
        backdropFilter: compact ? 'blur(10px) saturate(130%)' : undefined,
        overflow: 'hidden',
      }}>
      <LoaderIsobars colour={P.isobar} />

      <div className="mwuk-breathe"
           style={{ position: 'relative', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: compact ? 16 : 22,
                    animation: 'mwuk-breathe 3.6s ease-in-out infinite' }}>
        <LoaderWordmark P={P} size={compact ? 'clamp(20px, 5vw, 30px)' : 'clamp(26px, 7vw, 46px)'} />
        <LoaderTrack P={P} width={compact ? 120 : 164} />
      </div>

      {note && (
        <p style={{
          position: 'relative', margin: 0,
          fontFamily: 'Archivo, system-ui, sans-serif', fontSize: 10, fontWeight: 700,
          letterSpacing: '0.22em', textTransform: 'uppercase', color: P.sub,
        }}>
          {note}
        </p>
      )}
    </motion.div>
  );
}

// ─── Main authenticated app ───────────────────────────────────────────────
const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, user, isAuthenticated } = useAuth();
  const [siteSettings, setSiteSettings] = useState(null);
  const [accessGranted, setAccessGranted] = useState(() => localStorage.getItem('site_access_granted') === 'true');

  useEffect(() => {
    const checkAndLoad = async () => {
      const list = await base44.entities.SiteSettings.list().catch(() => []);
      const s = list[0] || null;
      if (s && s.site_disabled && s.countdown_enabled && s.countdown_target && new Date(s.countdown_target) <= new Date()) {
        await base44.entities.SiteSettings.update(s.id, { site_disabled: false }).catch(() => {});
        setSiteSettings({ ...s, site_disabled: false });
      } else {
        setSiteSettings(s);
      }
    };
    checkAndLoad();
    const interval = setInterval(async () => {
      setSiteSettings(prev => {
        if (prev && prev.site_disabled && prev.countdown_enabled && prev.countdown_target && new Date(prev.countdown_target) <= new Date()) {
          base44.entities.SiteSettings.update(prev.id, { site_disabled: false }).catch(() => {});
          return { ...prev, site_disabled: false };
        }
        return prev;
      });
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  if (isLoadingPublicSettings || isLoadingAuth) {
    return <PageLoader note="Loading" />;
  }

  if (siteSettings?.site_disabled && (!isAuthenticated || user?.role !== 'admin') && !accessGranted) {
    return <SiteDisabled settings={siteSettings} onAccessGranted={() => setAccessGranted(true)} />;
  }

  if (authError) {
    if (authError.type === 'user_not_registered') return <UserNotRegisteredError />;
    // NOTE: we intentionally do NOT force a redirect to /login on auth_required.
    // The site is public — visitors can browse without logging in. Pages that
    // must stay private (e.g. AdminSettings) are still gated by AdminOnlyRoute /
    // ProtectedRoute below, which redirect to /login only for THOSE routes.
    // (For the site to be fully public, the base44 app's visibility/auth setting
    // must also be set to public in the dashboard — that is enforced server-side
    // and cannot be changed from the frontend.)
  }

  const isRestrictedUser = accessGranted && siteSettings?.site_disabled && (!isAuthenticated || user?.role !== 'admin');

  /* Admin Settings owns the version tag. The build's own version stands in when
     nobody has set one, so the corner is never blank. */
  const buildVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
  const versionLabel = (siteSettings?.version || '').trim() || (buildVersion ? `v${buildVersion}` : '');

  return (
    <div>
      {isRestrictedUser && <RestrictedSiteOverlay settings={siteSettings} />}

      {/* The site version, bottom left, on every page.
          It lives HERE rather than in Layout for two reasons: LiveStream
          bypasses Layout entirely, and PageWrapper applies a transform while
          pages animate — which makes a position:fixed child cling to the
          moving page instead of the viewport. Out here it just stays in the
          corner. It clears the mobile tab bar, sits below it in the stack, and
          never takes the pointer. */}
      {versionLabel && (
        <div
          className="fixed left-4 z-40 bottom-[calc(env(safe-area-inset-bottom,0px)+4.75rem)] md:bottom-4
                     text-[11px] leading-none tracking-wide pointer-events-none select-none"
          style={{ color: 'var(--text-muted)', opacity: 0.7 }}
        >
          {versionLabel}
        </div>
      )}
      <NewsletterPopup />
      <Routes>
        {/* Live streaming surface renders OUTSIDE PageWrapper. PageWrapper wraps
            pages in an animated motion.div that applies transform/filter, which
            creates a containing block — that traps this page's position:fixed
            full-screen layout against a zero-height ancestor and renders blank.
            Rendering it raw (no Layout chrome, no transition wrapper) fixes that. */}
        <Route path="/LiveStream" element={<LiveStream />} />
        <Route path="/livestream" element={<LiveStream />} />
        {/* Everything else goes through the normal animated wrapper. */}
        <Route path="*" element={
          <PageWrapper>
            <Routes>
              {Object.entries(Pages).map(([path, Page]) => (
                <Route key={path} path={`/${path}`} element={<LayoutWrapper currentPageName={path}><Page /></LayoutWrapper>} />
              ))}
              <Route path="/AdminSettings" element={<AdminOnlyRoute><LayoutWrapper currentPageName="AdminSettings"><AdminSettings /></LayoutWrapper></AdminOnlyRoute>} />
              <Route path="/Lightning" element={<LayoutWrapper currentPageName="Lightning"><TCM /></LayoutWrapper>} />
              {/* The page was "TCM Lightning" for its whole life, so every
                  bookmark, share and in-app deep link still points at the old
                  paths. They redirect rather than 404. */}
              <Route path="/TCMLightning" element={<Navigate to="/Lightning" replace />} />
              <Route path="/TCM" element={<Navigate to="/Lightning" replace />} />
              <Route path="/WeatherCriteria" element={<LayoutWrapper currentPageName="WeatherCriteria"><WeatherCriteria /></LayoutWrapper>} />
              <Route path="/News" element={<LayoutWrapper currentPageName="News"><News /></LayoutWrapper>} />
              <Route path="/ModelData" element={<LayoutWrapper currentPageName="ModelData"><ModelData /></LayoutWrapper>} />
              {/* /TCMV5 is the V5 engine's own address. /TCMOutlooks still
                  resolves to the same page — every existing link keeps
                  working — but the engine you are looking at is now in the
                  URL rather than implied by a remembered preference. */}
              <Route path="/TCMNova" element={<LayoutWrapper currentPageName="TCMNova"><TCMOutlooks forceEngine="nova" /></LayoutWrapper>} />
              {/* TCM NOVA replaced TCM V5; the old address keeps working */}
              <Route path="/TCMV5" element={<LayoutWrapper currentPageName="TCMNova"><TCMOutlooks forceEngine="nova" /></LayoutWrapper>} />
              <Route path="/TCMOutlooks" element={<LayoutWrapper currentPageName="TCMOutlooks"><TCMOutlooks /></LayoutWrapper>} />
              <Route path="/WeatherPatterns" element={<LayoutWrapper currentPageName="WeatherPatterns"><WeatherPatterns /></LayoutWrapper>} />
              <Route path="/TCMArchive" element={<LayoutWrapper currentPageName="TCMArchive"><TCMArchive /></LayoutWrapper>} />
              <Route path="/MyWeatherArchive" element={<LayoutWrapper currentPageName="MyWeatherArchive"><MyWeatherArchive /></LayoutWrapper>} />
              <Route path="/WeatherScenarios" element={<LayoutWrapper currentPageName="WeatherScenarios"><WeatherScenarios /></LayoutWrapper>} />
              <Route path="/ForecastVerification" element={<LayoutWrapper currentPageName="ForecastVerification"><ForecastVerification /></LayoutWrapper>} />
              <Route path="/MyWeatherGraphics" element={<LayoutWrapper currentPageName="MyWeatherGraphics"><MyWeatherGraphics /></LayoutWrapper>} />
              <Route path="/ThunderstormStudio" element={<LayoutWrapper currentPageName="ThunderstormStudio"><ThunderstormStudio /></LayoutWrapper>} />
              <Route path="/ModelFeedback" element={<LayoutWrapper currentPageName="ModelFeedback"><ModelFeedback /></LayoutWrapper>} />
              <Route path="/TCMVerification" element={<LayoutWrapper currentPageName="TCMVerification"><TCMVerification /></LayoutWrapper>} />
              <Route path="/NewsletterSignup" element={<LayoutWrapper currentPageName="NewsletterSignup"><NewsletterSignup /></LayoutWrapper>} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              {/* Landing page is public — no login wall for general site access. */}
              <Route path="/" element={<DynamicLandingPage />} />
              <Route path="*" element={<PageNotFound />} />
            </Routes>
          </PageWrapper>
        } />
      </Routes>
    </div>
  );
};

function App() {
  return (
    <LanguageProvider>
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <NavigationTracker />
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <SonnerToaster />
      </QueryClientProvider>
    </AuthProvider>
    </LanguageProvider>
  );
}

export default App;