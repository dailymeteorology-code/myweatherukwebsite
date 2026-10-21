import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Info, AlertTriangle, Bell, Zap, ChevronRight } from 'lucide-react';

// ─── Priority config ───────────────────────────────────────────────────────────

const PRIORITY = {
  info: {
    Icon: Info,
    accent: '#60a5fa',
    glow: 'rgba(96,165,250,0.18)',
    border: 'rgba(96,165,250,0.25)',
    badge: { bg: 'rgba(96,165,250,0.12)', color: '#93c5fd' },
    orb: 'radial-gradient(circle, rgba(96,165,250,0.22) 0%, transparent 70%)',
  },
  warning: {
    Icon: AlertTriangle,
    accent: '#fb923c',
    glow: 'rgba(251,146,60,0.18)',
    border: 'rgba(251,146,60,0.25)',
    badge: { bg: 'rgba(251,146,60,0.12)', color: '#fdba74' },
    orb: 'radial-gradient(circle, rgba(251,146,60,0.22) 0%, transparent 70%)',
  },
  urgent: {
    Icon: Bell,
    accent: '#f87171',
    glow: 'rgba(248,113,113,0.22)',
    border: 'rgba(248,113,113,0.3)',
    badge: { bg: 'rgba(248,113,113,0.12)', color: '#fca5a5' },
    orb: 'radial-gradient(circle, rgba(248,113,113,0.25) 0%, transparent 70%)',
  },
  update: {
    Icon: Zap,
    accent: '#34d399',
    glow: 'rgba(52,211,153,0.18)',
    border: 'rgba(52,211,153,0.25)',
    badge: { bg: 'rgba(52,211,153,0.12)', color: '#6ee7b7' },
    orb: 'radial-gradient(circle, rgba(52,211,153,0.22) 0%, transparent 70%)',
  },
};

const CATEGORY_LABELS = {
  new_feature: '✦ New Feature',
  coming_soon: '◷ Coming Soon',
};

const KEYFRAMES = `
  @keyframes orb-drift {
    0%, 100% { transform: translate(0, 0) scale(1); }
    33%       { transform: translate(6px, -8px) scale(1.05); }
    66%       { transform: translate(-4px, 4px) scale(0.97); }
  }
  @keyframes urgent-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(248,113,113,0); }
    50%       { box-shadow: 0 0 0 6px rgba(248,113,113,0.12); }
  }
`;

function StyleInject() {
  useEffect(() => {
    const id = 'banner-stack-styles';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = KEYFRAMES;
    document.head.appendChild(el);
    return () => { document.getElementById(id)?.remove(); };
  }, []);
  return null;
}

// ─── Single item card ──────────────────────────────────────────────────────────

function ItemCard({ item, index, onDismiss }) {
  const isAnnouncement = item.type === 'announcement';
  const cfg = PRIORITY[item.priority] ?? PRIORITY.info;
  const { Icon } = cfg;
  const categoryLabel = isAnnouncement && CATEGORY_LABELS[item.category];
  const message = isAnnouncement ? item.message : item.description;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 32, scale: 0.94, transition: { duration: 0.18 } }}
      transition={{ delay: index * 0.06, type: 'spring', stiffness: 380, damping: 30 }}
      style={{
        position: 'relative',
        borderRadius: 16,
        padding: '1px',
        background: `linear-gradient(135deg, ${cfg.border}, rgba(255,255,255,0.04) 60%, transparent)`,
        animation: item.priority === 'urgent' ? 'urgent-pulse 2.4s ease-in-out infinite' : undefined,
        flexShrink: 0, // never let cards shrink — the scroll container handles overflow
      }}
    >
      <div style={{
        position: 'relative',
        borderRadius: 15,
        padding: '14px 16px',
        background: 'rgba(18,16,32,0.92)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        gap: 14,
        overflow: 'hidden',
      }}>
        {/* Ambient orb */}
        <div style={{
          position: 'absolute', top: -40, right: -40,
          width: 140, height: 140,
          background: cfg.orb, borderRadius: '50%',
          pointerEvents: 'none',
          animation: 'orb-drift 7s ease-in-out infinite',
        }} />

        {/* Shimmer on load */}
        <motion.div
          initial={{ x: '-120%' }} animate={{ x: '220%' }}
          transition={{ delay: index * 0.06 + 0.15, duration: 0.55, ease: 'easeOut' }}
          style={{
            position: 'absolute', top: 0, left: 0, width: '40%', height: '100%',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
            transform: 'skewX(-12deg)', pointerEvents: 'none',
          }}
        />

        {/* Icon */}
        <motion.div
          initial={{ scale: 0.6, rotate: -15 }} animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: index * 0.06 + 0.08, type: 'spring', stiffness: 280, damping: 18 }}
          style={{
            flexShrink: 0, width: 40, height: 40, borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `linear-gradient(135deg, ${cfg.glow}, rgba(255,255,255,0.04))`,
            border: `1px solid ${cfg.border}`,
            boxShadow: `0 0 16px ${cfg.glow}, inset 0 1px 0 rgba(255,255,255,0.08)`,
            position: 'relative', zIndex: 1,
          }}
        >
          <Icon size={17} color={cfg.accent} strokeWidth={2} />
        </motion.div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
          {/* Top row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {categoryLabel && (
                <motion.span
                  initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: index * 0.06 + 0.18, type: 'spring' }}
                  style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20,
                    background: cfg.badge.bg, color: cfg.accent, border: `1px solid ${cfg.border}`,
                  }}
                >
                  {categoryLabel}
                </motion.span>
              )}
              {!isAnnouncement && item.version && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                  background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)',
                  border: '1px solid rgba(255,255,255,0.08)', letterSpacing: '0.04em',
                }}>
                  {item.version}
                </span>
              )}
            </div>

            <motion.button
              whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.88 }}
              onClick={() => onDismiss(item.id)}
              aria-label={`Dismiss ${item.title}`}
              style={{
                flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
                cursor: 'pointer', color: 'rgba(255,255,255,0.35)',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; }}
            >
              <X size={11} />
            </motion.button>
          </div>

          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#ffffff', lineHeight: 1.35, letterSpacing: '-0.01em' }}>
            {item.title}
          </p>

          <p style={{ margin: '5px 0 0', fontSize: 12, lineHeight: 1.6, color: 'rgba(255,255,255,0.52)', whiteSpace: 'pre-line' }}>
            {message}
          </p>

          {isAnnouncement && item.link_url && (
            <motion.a
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06 + 0.25 }}
              href={item.link_url}
              target={item.link_url.startsWith('http') ? '_blank' : '_self'}
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 10,
                fontSize: 11, fontWeight: 700, letterSpacing: '0.02em', padding: '5px 12px',
                borderRadius: 8, background: `linear-gradient(135deg, ${cfg.accent}22, ${cfg.accent}11)`,
                border: `1px solid ${cfg.border}`, color: cfg.accent, textDecoration: 'none',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.78'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              {item.link_label || 'Learn more'}
              <ChevronRight size={11} />
            </motion.a>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Accent dots ───────────────────────────────────────────────────────────────

function AccentBar({ items }) {
  const priorities = ['urgent', 'warning', 'update', 'info'];
  const present = priorities.filter(p => items.some(i => i.priority === p));
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {present.map(p => (
        <div key={p} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: PRIORITY[p].accent, boxShadow: `0 0 6px ${PRIORITY[p].accent}`,
        }} />
      ))}
    </div>
  );
}

// ─── Main export ───────────────────────────────────────────────────────────────

export default function CombinedBannerStack({
  announcements = [],
  updates = [],
  currentPage = '',
  onAllDismissed,
}) {
  const [dismissed, setDismissed] = useState([]);

  // Announcements show purely on their own active state — never a "restricted
  // access" notice, and restricted mode no longer hides real announcements.
  const activeAnnouncements = announcements.filter(a => {
    if (a.is_active !== true) return false;
    if (dismissed.includes(a.id)) return false;
    if (a.target_page && currentPage && a.target_page !== currentPage) return false;
    return true;
  });

  const activeUpdates = updates.filter(
    u => u.is_published === true && !dismissed.includes(u.id)
  );

  const allItems = [
    ...activeAnnouncements.map(a => ({ ...a, type: 'announcement', priority: a.priority || 'info' })),
    ...activeUpdates.map(u => ({ ...u, type: 'update', priority: 'update' })),
  ]
    .filter((item, idx, arr) => arr.findIndex(i => i.id === item.id) === idx)
    .sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999));

  /* The parent is told outside the state update: calling it from inside the updater set the
     home page's state while this component was rendering, which React warns about (and runs
     twice in strict mode). */
  const handleDismiss = useCallback(id => {
    const next = [...dismissed, id];
    setDismissed(next);
    if (allItems.every(item => next.includes(item.id))) onAllDismissed?.();
  }, [allItems, dismissed, onAllDismissed]);

  const dismissAll = useCallback(() => {
    setDismissed(prev => [...new Set([...prev, ...allItems.map(i => i.id)])]);
    onAllDismissed?.();
  }, [allItems, onAllDismissed]);

  useEffect(() => {
    // only while the stack is showing: Esc closing some other sheet must not count as a dismissal
    const onKey = e => { if (e.key === 'Escape' && allItems.length) dismissAll(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismissAll, allItems.length]);

  // Lock body scroll while modal is open
  useEffect(() => {
    if (allItems.length > 0) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [allItems.length]);

  if (allItems.length === 0) return <StyleInject />;

  // ── Modal markup ─────────────────────────────────────────────────────────────
  // Portalled directly into document.body to escape any ancestor stacking
  // contexts created by framer-motion's willChange / filter / transform.
  const modal = (
    <>
      <StyleInject />
      <motion.div
        key="banner-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        onClick={dismissAll}
        style={{
          // Full-viewport fixed backdrop — rendered in body portal so nothing
          // clips or repositions it.
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 999999,
          background: 'rgba(4,3,12,0.82)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          // Flex centre
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          boxSizing: 'border-box',
          // Allow touch scroll events to pass through to the inner list
          touchAction: 'none',
        }}
      >
        {/* ── Dialog panel ── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 28 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.86, y: -20 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          onClick={e => e.stopPropagation()}
          style={{
            // Size
            width: '100%',
            maxWidth: 480,
            // Height: flex column that fills up to 85% of viewport height
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 'calc(85vh - 32px)', // 32px = 2× 16px padding
            // Gradient border trick (1px padding + gradient background)
            background: 'linear-gradient(160deg, rgba(255,255,255,0.12), rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.08))',
            padding: '1px',
            borderRadius: 22,
            boxShadow: '0 48px 96px rgba(0,0,0,0.75), 0 0 0 0.5px rgba(255,255,255,0.06)',
            // Must NOT have overflow:hidden here — let the inner panel handle it
          }}
        >
          {/* ── Glass inner panel ── */}
          <div style={{
            background: 'rgba(10,8,22,0.97)',
            borderRadius: 21,
            // This is the flex column that enforces the height budget
            display: 'flex',
            flexDirection: 'column',
            // Fill the outer panel and respect its maxHeight
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
          }}>

            {/* Header — fixed height, never scrolls */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <AccentBar items={allItems} />
                <span style={{
                  fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.55)',
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                }}>
                  Updates
                </span>
                <motion.span
                  key={allItems.length}
                  initial={{ scale: 1.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  style={{
                    fontSize: 10, fontWeight: 700, minWidth: 18, height: 18, borderRadius: 9,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)',
                  }}
                >
                  {allItems.length}
                </motion.span>
              </div>

              <motion.button
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
                onClick={dismissAll}
                style={{
                  fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 20,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
                  color: 'rgba(255,255,255,0.38)', cursor: 'pointer', letterSpacing: '0.03em',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; e.currentTarget.style.color = 'rgba(255,255,255,0.65)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'rgba(255,255,255,0.38)'; }}
              >
                Dismiss all
              </motion.button>
            </div>

            {/* Scrollable list — flex: 1 + minHeight: 0 is the key combo that
                makes overflowY:auto actually trigger instead of expanding forever */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                overflowX: 'hidden',
                WebkitOverflowScrolling: 'touch', // smooth momentum on iOS
                touchAction: 'pan-y',             // allow vertical touch scroll
                padding: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                overscrollBehavior: 'contain',
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(255,255,255,0.15) transparent',
              }}
              // Stop backdrop click-to-dismiss firing when scrolling inside
              onClick={e => e.stopPropagation()}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                {allItems.map((item, idx) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    index={idx}
                    onDismiss={handleDismiss}
                  />
                ))}
              </AnimatePresence>
            </div>

            {/* Footer — fixed height, never scrolls */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
              style={{
                padding: '10px 16px',
                borderTop: '1px solid rgba(255,255,255,0.04)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
                flexShrink: 0,
              }}
            >
              {['esc to close', 'click outside to dismiss'].map((hint, i) => (
                <span key={i} style={{
                  fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  {i > 0 && <span style={{ width: 2, height: 2, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'inline-block' }} />}
                  {hint}
                </span>
              ))}
            </motion.div>

          </div>
        </motion.div>
      </motion.div>
    </>
  );

  // Portal to body — completely outside the PageWrapper motion.div stacking context
  return createPortal(modal, document.body);
}