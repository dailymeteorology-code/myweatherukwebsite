/* Warnings, the app's Warnings tab (17 Nov 2026, the iOS-app redesign): the Met Office's warnings and our
   own, in force and upcoming, with the warning map and every past warning. The panel is the one the home
   page had (moved here unchanged); its data comes from hooks/useWarnings, which the Hub shares. */
import React, { useState, useEffect, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CloudSun, RefreshCw, Loader2, ExternalLink, History } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import WarningCard from '@/components/WarningCard';
import SeverityFilter from '@/components/SeverityFilter';
import WarningsMapModal from '@/components/WarningsMapModal';
import WarningsArchiveModal from '@/components/warnings/WarningsArchiveModal';
import WarningsRefreshBadge from '@/components/home/WarningsRefreshBadge';
import { useTheme } from '@/components/ThemeContext';
import { useWarnings } from '@/hooks/useWarnings';
import { injectThemeStyles, SectionHeader, Section, Pane, quietBtn, EmptyState, LoadingSpinner } from '@/components/hub/glass';
import LargeTitle from '@/components/app/LargeTitle';

export default function Warnings() {
  const { isDark } = useTheme();
  useLayoutEffect(() => { injectThemeStyles(); }, []);
  useLayoutEffect(() => { document.documentElement.classList.toggle('light-mode', !isDark); }, [isDark]);

  const {
    mergedActive, mergedUpcoming, mergedAll, loadingWarnings, refreshing, lastUpdated, nextUpdate, warningsSource,
    fetchWarnings, deleteManualWarning, statusDot, statusText, redWildfire,
  } = useWarnings();

  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => { base44.auth.me().then((u) => setIsOwner(u?.role === 'admin')).catch(() => setIsOwner(false)); }, []);

  const [severityFilter, setSeverityFilter] = useState(null);
  /* null = follow the content: whichever of in force / upcoming has something in it; a pick sticks */
  const [warnTab, setWarnTab] = useState(null);
  const [showWarningsMap, setShowWarningsMap] = useState(false);
  /* a warning card opens the map on its own warning: that day, its area, its details beside it */
  const [mapFocus, setMapFocus] = useState(null);
  const openWarningMap = (warning = null) => { setMapFocus(warning); setShowWarningsMap(true); };
  const [showWarningsArchive, setShowWarningsArchive] = useState(false);

  const filteredWarnings = severityFilter ? mergedActive.filter((w) => w.severity === severityFilter) : mergedActive;
  const filteredUpcoming = severityFilter ? mergedUpcoming.filter((w) => w.severity === severityFilter) : mergedUpcoming;


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
                    type="button" onClick={() => fetchWarnings()} disabled={loadingWarnings}
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
                      isOwner={isOwner} onDelete={deleteManualWarning} onOpen={openWarningMap} />
                  </div>
                ))}
              </motion.div>
            ) : (
              <EmptyState
                key={`empty-${currentTab.id}-${severityFilter}`}
                icon={CloudSun} iconColor="var(--accent-uk)"
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
            <button type="button" onClick={() => openWarningMap()} style={quietBtn}>
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

  return (
    <div className="lg-page min-h-screen relative">
      <div className="lg-ambient" aria-hidden="true">
        <i className="lg-orb-a" /><i className="lg-orb-b" /><i className="lg-orb-c" />
      </div>
      <main style={{ position: 'relative', zIndex: 1, paddingBottom: 'clamp(40px, 8vw, 88px)' }}>
        <LargeTitle title="Warnings" subtitle={!loadingWarnings && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
            <span style={{ position: 'relative', display: 'flex', width: 9, height: 9 }}>
              <span className="lg-ping" style={{ position: 'absolute', inset: 0, borderRadius: 99, background: statusDot, opacity: 0.75 }} />
              <span style={{ position: 'relative', width: 9, height: 9, borderRadius: 99, background: statusDot }} />
            </span>
            {statusText}
          </span>
        )} />

        {/* A red wildfire warning is the one thing allowed to interrupt. */}
        {redWildfire && (
          <Section>
            <div className="lg-pane" style={{
              display: 'flex', alignItems: 'center', gap: 13, padding: 'clamp(14px, 3vw, 18px) clamp(16px, 3vw, 22px)',
              background: 'var(--tint-red)', borderColor: 'rgba(248,113,113,0.42)',
            }}>
              <AlertTriangle style={{ width: 20, height: 20, color: '#f87171', flexShrink: 0 }} />
              <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--ink-1)' }}>
                The UK Government has issued a nationwide wildfire warning
              </p>
            </div>
          </Section>
        )}

        {warningsBlock}
      </main>

      <WarningsMapModal isOpen={showWarningsMap} onClose={() => { setShowWarningsMap(false); setMapFocus(null); }} warnings={mergedAll} focus={mapFocus} />
      <WarningsArchiveModal isOpen={showWarningsArchive} onClose={() => setShowWarningsArchive(false)} />
    </div>
  );
}
