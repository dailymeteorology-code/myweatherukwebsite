/* The Hub (17 Nov 2026, the iOS-app redesign): what was the home page, now that the home page is the weather where
   you are. It keeps the graphics, live lightning, the weather across the UK and Ireland (no longer the rest of
   the world) and the rain radar; the warnings have their own tab (pages/Warnings.jsx), and the first-visit notices
   moved with the home page (components/app/FirstVisitNotices.jsx). Its glass look is components/hub/glass.jsx. */
import React, { useState, useEffect, useLayoutEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, ChevronRight, ExternalLink, Sparkles, Megaphone, Zap } from 'lucide-react';
import SocialLinks from '@/components/SocialLinks';
import ForecastSection from '@/components/ForecastSection';
import { sized, sizedSet } from '@/lib/sizedImage';
import CountdownDisplay from '@/components/CountdownDisplay';
import LocationRadar from '@/components/location/LocationRadar';
import CityConditions from '@/components/home/CityConditions';
import { ConditionChips, ThunderstormRisks } from '@/components/graphics/GraphicMeta';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useTheme } from '@/components/ThemeContext';
import { injectThemeStyles, SectionHeader, Section, Pane, quietBtn } from '@/components/hub/glass';
import { useWarnings } from '@/hooks/useWarnings';
import LargeTitle from '@/components/app/LargeTitle';

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

  useLayoutEffect(() => {
    injectThemeStyles();
  }, []);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('light-mode', !isDark);
  }, [isDark]);

  // ── Summer theme. A site setting (Admin Settings → Site Control), so every visitor gets it
  //    once the settings arrive; the last value seen is kept in this browser so a returning
  //    visitor's first paint is already right instead of changing a moment later.
  const SUMMER_KEY = 'mwuk_summer_theme';
  const [summerThemeOn, setSummerThemeOn] = useState(() => {
    try { return localStorage.getItem(SUMMER_KEY) === 'true'; } catch { return false; }
  });
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('summer-theme', summerThemeOn);
    // Home only: strip it on the way out so it does not leak onto other routes.
    return () => document.documentElement.classList.remove('summer-theme');
  }, [summerThemeOn]);
  // ── Weather warnings: only their status line here; the Warnings tab has them all ──
  const { loadingWarnings, loadWarningsFromDB, statusDot, statusText, redWildfire } = useWarnings();
  const navigate = useNavigate();
  const goToWarnings = () => navigate('/Warnings');

  // ── UI ──
  const [isOwner, setIsOwner] = useState(false);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Auth bootstrap ──
  useEffect(() => {
    base44.auth.me().
    then((user) => setIsOwner(user?.role === 'admin')).
    catch(() => setIsOwner(false));
  }, []);

  const { isPulling, isRefreshing, pullProgress, onTouchStart, onTouchMove, onTouchEnd } =
  usePullToRefresh(loadWarningsFromDB);

  // ── Remote queries ──
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {try {const l = await base44.entities.SiteSettings.list();return l?.[0] || null;} catch {return null;}},
    // every 30 s rather than every 5: an admin's change still shows within the half-minute,
    // and visitors are not each asking twelve times a minute for something that rarely changes
    refetchInterval: 30000, retry: 2, retryDelay: 1000
  });
  useEffect(() => {
    if (typeof settings?.summer_theme !== 'boolean') return;
    setSummerThemeOn(settings.summer_theme);
    try { localStorage.setItem(SUMMER_KEY, String(settings.summer_theme)); } catch { /* private mode */ }
  }, [settings?.summer_theme]);
  /* /#forecasts (the admin overview's "Graphics in force" and "Add a forecast graphic") lands on
     the graphics — from another page, and from this one, where following the
     link does not remount the page, so it watches the location rather than reading it once. */
  const location = useLocation();
  useEffect(() => {
    if (location.hash !== '#forecasts') return undefined;
    const t = setTimeout(() => document.getElementById('forecasts')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 500);
    return () => clearTimeout(t);
  }, [location.hash, location.key]);

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

  /* The admin's countdown (Admin Settings → Site Control): switched on, with a target, and set
     to show on the home page. */
  const showCountdown = !!(settings?.countdown_enabled && settings?.countdown_target
    && settings?.countdown_display === 'homepage');

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

      <main style={{ position: 'relative', zIndex: 1, paddingBottom: 'clamp(40px, 8vw, 88px)' }}>

        {/* ══ OPENING: the Hub's name, as an iOS tab's first screen has it, and whether any warning is in force,
            which opens the Warnings tab ══ */}
        <LargeTitle
          title="Hub"
          subtitle={<span translate="no">{settings?.site_name || 'MyWeatherUK'} · Alert. Aware. Safe</span>} />
        <div className="mx-auto w-full px-4 sm:px-6" style={{ maxWidth: 1120 }}>
          <AnimatePresence>
            {!loadingWarnings && (
              <motion.button
                type="button" onClick={goToWarnings}
                aria-label={`${statusText}. Open the Warnings tab.`}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="lg-pane lg-status"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '10px 14px 10px 16px', borderRadius: 99, marginTop: 14 }}>
                <span style={{ position: 'relative', display: 'flex', width: 9, height: 9 }}>
                  <span className="lg-ping" style={{ position: 'absolute', inset: 0, borderRadius: 99, background: statusDot, opacity: 0.75 }} />
                  <span style={{ position: 'relative', width: 9, height: 9, borderRadius: 99, background: statusDot }} />
                </span>
                <span style={{ fontSize: '0.9rem', fontWeight: 650, color: 'var(--ink-1)' }}>{statusText}</span>
                <ChevronRight aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--ink-3)' }} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

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

        {showCountdown && (
          <Section>
            <CountdownDisplay
              target={settings.countdown_target}
              title={settings.countdown_title}
              description={settings.countdown_description} />
          </Section>
        )}

        {/* ══ CONDITIONS ════════════════════════════════════════════════════════ */}
        <Section id="cityConditions">
          <SectionHeader eyebrow="Right now" title="Across the UK and Ireland" />
          <Pane pad={false} style={{ padding: 'clamp(12px, 2.4vw, 18px)' }}>
            <CityConditions ukOnly />
          </Pane>
        </Section>


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
                <div className="flex items-center flex-wrap" style={{ marginBottom: 13, gap: 10 }}>
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
