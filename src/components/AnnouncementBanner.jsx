import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { X, Info, AlertTriangle, Bell, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';

// ─── Data ──────────────────────────────────────────────────────────────────────

const CATEGORY_CAPSULE = {
  new_feature: { label: '✦ New Feature', style: { background: 'rgba(255,255,255,0.18)', color: '#fff' } },
  coming_soon: { label: '◷ Coming Soon', style: { background: 'rgba(255,255,255,0.18)', color: '#fff' } },
};

const PRIORITY_CONFIG = {
  info:    { Icon: Info,          gradient: ['#3B7CF4', '#1a3a8a', '#0c1f54'] },
  warning: { Icon: AlertTriangle, gradient: ['#E8922A', '#7a3d0a', '#3d1c04'] },
  urgent:  { Icon: Bell,          gradient: ['#E53935', '#7a0f0f', '#3d0505'] },
};

// ─── Countdown hook ─────────────────────────────────────────────────────────

function useCountdown(seconds) {
  const [remaining, setRemaining] = useState(seconds ?? null);
  useEffect(() => {
    if (!seconds) return;
    setRemaining(seconds);
    const id = setInterval(() => setRemaining(r => (r <= 1 ? (clearInterval(id), 0) : r - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds]);
  return remaining;
}

function fmt(s) {
  if (s === null) return null;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// ─── Drag-to-dismiss card ──────────────────────────────────────────────────

function DraggableCard({ announcement: a, onDismiss, isOnly }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-180, 180], [-10, 10]);
  const cardOpacity = useTransform(x, [-140, 0, 140], [0.35, 1, 0.35]);

  const config = PRIORITY_CONFIG[a.priority] ?? PRIORITY_CONFIG.info;
  const { Icon } = config;
  const [hiColor, midBg, darkBg] = config.gradient;
  const capsule = CATEGORY_CAPSULE[a.category];
  const countdown = useCountdown(a.countdown ?? null);
  const progress = a.countdown && countdown !== null ? 1 - countdown / a.countdown : 0;

  function handleDragEnd(_, info) {
    if (Math.abs(info.offset.x) > 90 || Math.abs(info.velocity.x) > 500) onDismiss();
  }

  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.14}
      style={{ x, rotate, opacity: cardOpacity }}
      onDragEnd={handleDragEnd}
      className="relative w-full max-w-[400px] mx-auto cursor-grab active:cursor-grabbing select-none"
      onClick={e => e.stopPropagation()}
    >
      {/* Urgent pulse ring */}
      {a.priority === 'urgent' && (
        <motion.span
          className="absolute inset-[-8px] rounded-[28px] pointer-events-none"
          style={{ border: `2px solid ${hiColor}`, borderRadius: 28 }}
          animate={{ opacity: [0.55, 0.1, 0.55], scale: [1, 1.015, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Card */}
      <div
        className="overflow-hidden rounded-[22px]"
        style={{
          background: `linear-gradient(150deg, ${midBg} 0%, ${darkBg} 100%)`,
          boxShadow: `0 32px 72px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.09), inset 0 1px 0 rgba(255,255,255,0.1)`,
        }}
      >
        {/* Slim progress bar */}
        {a.countdown != null && (
          <div className="w-full h-[3px]" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <motion.div
              className="h-full"
              style={{ background: hiColor, borderRadius: 2 }}
              animate={{ width: `${progress * 100}%` }}
              transition={{ duration: 0.8, ease: 'linear' }}
            />
          </div>
        )}

        {/* Header strip */}
        <div className="flex items-center justify-between px-5 pt-4 pb-0">
          <div className="flex items-center gap-2">
            {capsule && (
              <span
                className="text-[10px] font-semibold tracking-widest uppercase px-2.5 py-1 rounded-full"
                style={capsule.style}
              >
                {capsule.label}
              </span>
            )}
            {a.countdown != null && countdown !== null && (
              <span className="text-[10px] font-medium tracking-wide" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {fmt(countdown)} left
              </span>
            )}
          </div>

          <motion.button
            whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.22)' }}
            whileTap={{ scale: 0.92 }}
            onClick={onDismiss}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.14)' }}
            aria-label="Dismiss"
          >
            <X className="w-[14px] h-[14px] text-white/70" />
          </motion.button>
        </div>

        {/* Body */}
        <div className="px-5 pt-4 pb-2">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="flex items-start gap-3.5"
          >
            {/* Icon blob */}
            <motion.div
              initial={{ scale: 0.7, rotate: -12 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.15, type: 'spring', stiffness: 260, damping: 18 }}
              className="flex-shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center mt-0.5"
              style={{ background: 'rgba(255,255,255,0.12)', boxShadow: `0 0 0 1px rgba(255,255,255,0.1), 0 6px 18px rgba(0,0,0,0.25)` }}
            >
              <Icon className="w-5 h-5 text-white" />
            </motion.div>

            <div className="flex-1 min-w-0">
              <motion.h4
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.12 }}
                className="text-white font-bold text-[18px] leading-snug"
              >
                {a.title}
              </motion.h4>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-[13px] leading-relaxed mt-1.5 whitespace-pre-line"
                style={{ color: 'rgba(255,255,255,0.7)' }}
              >
                {a.message}
              </motion.p>
            </div>
          </motion.div>
        </div>

        {/* Actions */}
        {a.link_url && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.26 }}
            className="px-5 pt-2 pb-5 flex items-center gap-2"
          >
            <a
              href={a.link_url}
              target={a.link_url.startsWith('http') ? '_blank' : '_self'}
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 rounded-xl transition-all hover:opacity-90 active:scale-95"
              style={{ background: hiColor, color: '#fff', boxShadow: `0 4px 14px rgba(0,0,0,0.3)` }}
            >
              {a.link_label ?? 'Learn more'} <ExternalLink className="w-3 h-3" />
            </a>
            <button
              onClick={onDismiss}
              className="text-xs font-medium px-4 py-2.5 rounded-xl transition-all hover:bg-white/10 active:scale-95"
              style={{ color: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              Dismiss
            </button>
          </motion.div>
        )}

        {/* Drag hint — fades out after first drag */}
        {isOnly && (
          <p className="text-center text-[10px] pb-3 tracking-wide" style={{ color: 'rgba(255,255,255,0.22)' }}>
            swipe to dismiss
          </p>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function AnnouncementBanner({ announcements = [] }) {
  const [dismissed, setDismissed] = useState([]);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);

  const active = announcements.filter(a => a.is_active !== false && !dismissed.includes(a.id));

  // Reset index if it goes out of bounds
  useEffect(() => {
    if (index >= active.length && active.length > 0) setIndex(active.length - 1);
  }, [active.length, index]);

  // Keyboard support
  useEffect(() => {
    if (!active.length) return;
    function onKey(e) {
      if (e.key === 'Escape') dismiss(active[index].id);
      if (e.key === 'ArrowLeft'  && index > 0) navigate(index - 1);
      if (e.key === 'ArrowRight' && index < active.length - 1) navigate(index + 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, index]);

  const dismiss = useCallback(id => {
    setDismissed(prev => [...prev, id]);
    setIndex(i => Math.max(0, i - (i >= active.length - 1 ? 1 : 0)));
  }, [active.length]);

  function navigate(next) {
    setDirection(next > index ? 1 : -1);
    setIndex(next);
  }

  if (!active.length) return null;

  const current = active[index];
  const showNav = active.length > 1;

  const cardVariants = {
    enter:  d => ({ opacity: 0, x: d * 40, scale: 0.95 }),
    center: { opacity: 1, x: 0, scale: 1 },
    exit:   d => ({ opacity: 0, x: d * -40, scale: 0.95, transition: { duration: 0.18 } }),
  };

  return (
    <AnimatePresence>
      <motion.div
        key="overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(12px)' }}
        onClick={() => dismiss(current.id)}
      >
        {/* Counter */}
        {showNav && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs font-medium mb-4 tabular-nums"
            style={{ color: 'rgba(255,255,255,0.35)' }}
          >
            {index + 1} / {active.length}
          </motion.p>
        )}

        {/* Card with slide transition */}
        <div className="w-full max-w-[400px] relative">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={current.id}
              custom={direction}
              variants={cardVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            >
              <DraggableCard
                announcement={current}
                onDismiss={() => dismiss(current.id)}
                isOnly={active.length === 1}
              />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Dot nav + arrows */}
        {showNav && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="flex items-center gap-3 mt-5"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => navigate(index - 1)}
              disabled={index === 0}
              className="w-7 h-7 rounded-full flex items-center justify-center transition-all disabled:opacity-20 hover:bg-white/10"
              style={{ border: '1px solid rgba(255,255,255,0.2)' }}
            >
              <ChevronLeft className="w-4 h-4 text-white" />
            </button>

            <div className="flex items-center gap-1.5">
              {active.map((a, i) => (
                <motion.button
                  key={a.id}
                  onClick={() => navigate(i)}
                  animate={{ width: i === index ? 20 : 6, opacity: i === index ? 1 : 0.35 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                  className="h-1.5 rounded-full bg-white"
                  style={{ width: i === index ? 20 : 6 }}
                />
              ))}
            </div>

            <button
              onClick={() => navigate(index + 1)}
              disabled={index === active.length - 1}
              className="w-7 h-7 rounded-full flex items-center justify-center transition-all disabled:opacity-20 hover:bg-white/10"
              style={{ border: '1px solid rgba(255,255,255,0.2)' }}
            >
              <ChevronRight className="w-4 h-4 text-white" />
            </button>
          </motion.div>
        )}

        {/* Keyboard hint */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="absolute bottom-5 text-[10px] tracking-widest uppercase"
          style={{ color: 'rgba(255,255,255,0.18)' }}
        >
          esc to close{showNav ? '  ·  ← → to navigate' : ''}
        </motion.p>
      </motion.div>
    </AnimatePresence>
  );
}