import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

// App-wide pull-to-refresh. Wraps the page content and, on a completed pull,
// reloads the current view so any active weather data re-fetches. Touch-only,
// so the desktop web experience is unaffected.
export default function GlobalPullToRefresh({ children }) {
  const { isPulling, isRefreshing, pullProgress, onTouchStart, onTouchMove, onTouchEnd } =
    usePullToRefresh(async () => {
      // Universal refresh — reload the active view so its data re-fetches.
      window.location.reload();
      // Keep the spinner up until the reload takes over.
      await new Promise((r) => setTimeout(r, 1500));
    });

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <AnimatePresence>
        {(isPulling || isRefreshing) && (
          <motion.div
            key="global-ptr"
            initial={{ y: -48, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -48, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 280 }}
            style={{
              position: 'fixed',
              top: 'calc(12px + env(safe-area-inset-top, 0px))',
              left: '50%', transform: 'translateX(-50%)',
              zIndex: 9000, pointerEvents: 'none',
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 14px', borderRadius: 99,
              background: 'rgba(15,26,46,0.95)',
              border: '1px solid rgba(148,163,184,0.2)',
              backdropFilter: 'blur(14px)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
            }}
          >
            <motion.svg
              width="16" height="16" viewBox="0 0 16 16" style={{ flexShrink: 0 }}
              animate={isRefreshing ? { rotate: 360 } : { rotate: pullProgress * 300 }}
              transition={isRefreshing ? { duration: 0.9, repeat: Infinity, ease: 'linear' } : { duration: 0 }}
            >
              <circle cx="8" cy="8" r="6" fill="none" stroke="rgba(148,163,184,0.3)" strokeWidth="2" />
              <motion.circle cx="8" cy="8" r="6" fill="none"
                stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round"
                strokeDasharray="37.7"
                strokeDashoffset={isRefreshing ? 0 : 37.7 * (1 - pullProgress)}
                style={{ transformOrigin: '8px 8px', transform: 'rotate(-90deg)' }}
              />
            </motion.svg>
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
              color: '#94a3b8', fontFamily: 'DM Sans, system-ui, sans-serif',
            }}>
              {isRefreshing ? 'Refreshing…' : pullProgress >= 1 ? 'Release to refresh' : 'Pull to refresh'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      {children}
    </div>
  );
}