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
import Lightning from '@/pages/Lightning';
import WeatherPatterns from '@/pages/WeatherPatterns';
import TCMOutlooks from '@/pages/TCMOutlooks';
import TCMFrost from '@/pages/TCMFrost';
import News from '@/pages/News';
import ModelData from '@/pages/ModelData';
import TCMArchive from '@/pages/TCMArchive';
import MyWeatherArchive from '@/pages/MyWeatherArchive';
import WeatherScenarios from '@/pages/WeatherScenarios';
import ForecastVerification from '@/pages/ForecastVerification';
import GraphicStudio from '@/pages/GraphicStudio';
import LiveStream from '@/pages/LiveStream';
import TCMVerification from '@/pages/TCMVerification';
import NewsletterSignup from '@/pages/NewsletterSignup';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import { Navigate } from 'react-router-dom';
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import '@/components/app/app-screens.css';
import { SectionActiveContext } from '@/components/app/sectionActive';
import ScreenBoundary from '@/components/app/ScreenBoundary';
import TCMScreen from '@/components/tcm/TCMScreen';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout
  ? <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

/* ─── The app frame (17 Nov 2026, the iOS-app redesign) ───────────────────────
   "This is an app, not a website, we are not changing pages, we are going into a new section." The tab bar's
   sections (components/app/AppTabBar.jsx) are each made once, the first time they are opened, and then kept:
   the others stay mounted but hidden while one shows, so going back to a section is instant and it is as you
   left it (the place on Home, the map and its layer on Model Data, how far down you had scrolled). Each section
   keeps the address it last had (its own <Routes location>), so a hidden one never reacts to another's. Pages
   opened from More come and go as before, sliding in as an iOS app pushes a screen. The Layout, and with it the
   tab bar, is made once for all of them. This replaced PageWrapper, whose fade out, wait, fade in, progress bar
   and page-name flash made every tap feel like loading a new page. */
const SECTIONS = [
  { id: 'home', test: (p) => p === '/' || p === '/Home' || p === '/LocationWeather' },
  { id: 'model', test: (p) => p === '/ModelData' },
  { id: 'tcm', test: (p) => p === '/TCMOutlooks' || p === '/TCMNova' || p === '/TCMV5' },
  { id: 'warnings', test: (p) => p === '/Warnings' },
  { id: 'radar', test: (p) => p === '/Radar' },
  { id: 'more', test: (p) => p === '/More' },
];
const sectionOf = (p) => SECTIONS.find((s) => s.test(p))?.id || null;
/* pages the sections show, so they are not routed twice */
const IN_SECTIONS = new Set(['Home', 'LocationWeather', 'Warnings', 'Radar', 'More']);

/* the landing page: the admin's choice (SiteSettings.landing_page), else the main page */
function LandingSection() {
  const [Page, setPage] = useState(() => MainPage);
  useEffect(() => {
    base44.entities.SiteSettings.list().then((list) => {
      const lp = list[0]?.landing_page;
      setPage(() => (lp && Pages[lp]) || MainPage);
    }).catch(() => {});
  }, []);
  return <Page />;
}

/* the TCM tab: on a phone the app's own screen (components/tcm/TCMScreen.jsx, 17 Nov 2026); computers and tablets
   keep the full TCM V3 and NOVA pages */
const PHONE_Q = '(max-width: 767.98px)';
function usePhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_Q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_Q);
    if (!mq) return undefined;
    const on = () => setPhone(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return phone;
}
function TCMSection() {
  const phone = usePhone();
  if (phone) return <TCMScreen />;
  return (
    <Routes>
      <Route path="/TCMNova" element={<TCMOutlooks forceEngine="nova" />} />
      <Route path="/TCMV5" element={<TCMOutlooks forceEngine="nova" />} />
      <Route path="*" element={<TCMOutlooks />} />
    </Routes>
  );
}

function SectionScreen({ id }) {
  if (id === 'home') return <LandingSection />;
  if (id === 'model') return <ModelData />;
  if (id === 'tcm') return <TCMSection />;
  const Page = Pages[{ warnings: 'Warnings', radar: 'Radar', more: 'More' }[id]];
  return Page ? <Page /> : null;
}

function AppFrame() {
  const location = useLocation();
  const active = sectionOf(location.pathname);
  /* each section opened so far, with the address it last had */
  const [kept, setKept] = useState(() => (active ? { [active]: location } : {}));
  useEffect(() => {
    if (active) setKept((k) => (k[active] === location ? k : { ...k, [active]: location }));
  }, [active, location]);
  const sections = active ? { ...kept, [active]: location } : kept;

  /* each screen's scroll position: kept as you scroll, given back when you return to a section; a page opened
     from More starts at the top */
  const scrolls = useRef({});
  const showing = useRef(active || location.pathname);
  useEffect(() => {
    const save = () => { scrolls.current[showing.current] = window.scrollY; };
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, []);
  useLayoutEffect(() => {
    const key = active || location.pathname;
    if (showing.current === key) return;
    showing.current = key;
    window.scrollTo(0, active ? (scrolls.current[key] || 0) : 0);
  }, [active, location.pathname]);

  return (
    <LayoutWrapper currentPageName={active || location.pathname.slice(1) || 'Home'}>
      {Object.entries(sections).map(([id, loc]) => (
        /* a hidden section keeps its full size, out of sight (app-screens.css): hidden with display: none, every
           page that measures itself (Model Data's map, the radar, the charts) read a size of nothing and Model
           Data drew itself with a negative corner and took the app down */
        <div key={id} className="app-section" data-section={id} data-off={id !== active ? '' : undefined}
          aria-hidden={id !== active ? true : undefined} {...(id !== active ? { inert: '' } : {})}>
          <SectionActiveContext.Provider value={id === active}>
            <ScreenBoundary>
              <Routes location={loc}>
                <Route path="*" element={<SectionScreen id={id} />} />
              </Routes>
            </ScreenBoundary>
          </SectionActiveContext.Provider>
        </div>
      ))}
      {!active && (
        <div key={location.pathname} className="app-push">
          <ScreenBoundary resetKey={location.pathname}>
          <Routes>
            {Object.entries(Pages).filter(([path]) => !IN_SECTIONS.has(path)).map(([path, Page]) => (
              <Route key={path} path={`/${path}`} element={<Page />} />
            ))}
            <Route path="/AdminSettings" element={<AdminOnlyRoute><AdminSettings /></AdminOnlyRoute>} />
            <Route path="/Lightning" element={<Lightning />} />
            {/* The page was "TCM Lightning" for its whole life, so every bookmark, share and in-app deep link
                still points at the old paths. They redirect rather than 404. */}
            <Route path="/TCMLightning" element={<Navigate to="/Lightning" replace />} />
            <Route path="/TCM" element={<Navigate to="/Lightning" replace />} />
            <Route path="/WeatherCriteria" element={<Navigate to="/" replace />} />
            <Route path="/News" element={<News />} />
            {/* MWUK FROST, MyWeatherUK's snow model (13 Nov 2026) */}
            <Route path="/TCMFrost" element={<TCMFrost />} />
            <Route path="/WeatherPatterns" element={<WeatherPatterns />} />
            <Route path="/TCMArchive" element={<TCMArchive />} />
            <Route path="/MyWeatherArchive" element={<MyWeatherArchive />} />
            <Route path="/WeatherScenarios" element={<WeatherScenarios />} />
            <Route path="/ForecastVerification" element={<ForecastVerification />} />
            {/* the graphics in force are on the Hub: these two pages are gone (MyWeatherGraphics drew nothing;
                Graphics was removed on 22 Oct 2026), and old links land there */}
            <Route path="/MyWeatherGraphics" element={<Navigate to="/Hub" replace />} />
            <Route path="/Graphics" element={<Navigate to="/Hub" replace />} />
            <Route path="/GraphicStudio" element={<GraphicStudio />} />
            {/* the public studio was the Thunderstorm Studio until 22 Oct 2026 */}
            <Route path="/ThunderstormStudio" element={<Navigate to="/GraphicStudio" replace />} />
            <Route path="/ModelFeedback" element={<Navigate to="/ForecastVerification" replace />} />
            <Route path="/TCMVerification" element={<TCMVerification />} />
            <Route path="/NewsletterSignup" element={<NewsletterSignup />} />
            <Route path="*" element={<PageNotFound />} />
          </Routes>
          </ScreenBoundary>
        </div>
      )}
    </LayoutWrapper>
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

/** The theme, as index.html stamped it before the first paint (from the saved preferences), so
 *  the loader matches the page from its first frame. */
const loaderIsDark = () => document.documentElement.classList.contains('dark');

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
      <span translate="no" style={{ ...type, color: P.ink }}>
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


  return (
    <div>
      {isRestrictedUser && <RestrictedSiteOverlay settings={siteSettings} />}

      {/* The site's version (5.##.###, version.json) is at the foot of More, and nowhere else (17 Nov 2026, at
          the user's request); it used to float in the bottom-left corner of every page. */}
      <Routes>
        {/* Live streaming renders outside the app frame: no Layout chrome, nothing around it. */}
        <Route path="/LiveStream" element={<LiveStream />} />
        <Route path="/livestream" element={<LiveStream />} />
        {/* signing in: full-screen pages of their own, without the app's frame */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        {/* everything else: the app (AppFrame above) */}
        <Route path="*" element={<AppFrame />} />
      </Routes>
    </div>
  );
};

function App() {
  return (
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
  );
}

export default App;