import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

/**
 * THE HOMEPAGE COUNTDOWN.
 *
 * Set a target in Admin Settings → Site Control, choose "Homepage" as the
 * display location, and this appears in the hero.
 *
 * IT NEVER APPEARED BEFORE, for two reasons.
 *
 * The fatal one was a prop mismatch: the home page renders
 * `<CountdownDisplay target=… title=… description=… />`, and this component
 * took a single `settings` object and opened with `if (!settings) return null`.
 * So every one of the admin's four conditions could be satisfied and the thing
 * still rendered nothing, silently, with no error to go looking for.
 *
 * The second would have surfaced the moment the first was fixed: this was
 * written as a full-screen takeover — `min-h-screen`, its own gradient
 * background, absolutely positioned blur orbs — for a "coming soon" page. Drop
 * that into the middle of a hero and you get a viewport-tall gradient slab in
 * the middle of the home page. The Site Disabled screen has its own countdown
 * and never used this one, so the takeover styling was serving nobody; what was
 * needed here was a card that sits in the hero.
 *
 * Colours come from the page's own theme tokens, so it follows light and dark
 * with the rest of the page instead of assuming a dark background.
 */

function getTimeLeft(target) {
  if (!target) return null;
  const diff = new Date(target) - new Date();
  if (!Number.isFinite(diff) || diff <= 0) return null;
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
  };
}

function TimeBlock({ value, label }) {
  return (
    <div
      className="flex flex-col items-center rounded-xl px-3 py-2 sm:px-4 sm:py-2.5 min-w-[62px] sm:min-w-[72px]"
      style={{ background: 'var(--bg-pill)', border: '1px solid var(--border)' }}
    >
      <span className="text-2xl sm:text-3xl font-bold tabular-nums leading-none"
            style={{ color: 'var(--text-primary)' }}>
        {String(value).padStart(2, '0')}
      </span>
      <span className="text-[9.5px] sm:text-[10px] mt-1.5 uppercase tracking-[0.14em]"
            style={{ color: 'var(--text-secondary)' }}>
        {label}
      </span>
    </div>
  );
}

export default function CountdownDisplay({ target, title, description, settings }) {
  /* Explicit props win; `settings` is the older shape, kept so any caller that
     still passes one keeps working. */
  const to = target ?? settings?.countdown_target ?? null;
  const heading = title ?? settings?.countdown_title ?? '';
  const blurb = description ?? settings?.countdown_description ?? '';

  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft(to));

  useEffect(() => {
    if (!to) { setTimeLeft(null); return undefined; }
    // Recompute immediately as well as on the tick, so changing the target in
    // Admin Settings is reflected without waiting out a second.
    setTimeLeft(getTimeLeft(to));
    const id = setInterval(() => setTimeLeft(getTimeLeft(to)), 1000);
    return () => clearInterval(id);
  }, [to]);

  if (!to) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
      className="mx-auto w-full max-w-xl rounded-2xl px-5 py-4 text-center backdrop-blur-sm"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      {(heading || !timeLeft) && (
        <h3 className="text-sm sm:text-base font-bold" style={{ color: 'var(--text-primary)' }}>
          {heading || 'Coming soon'}
        </h3>
      )}
      {blurb && (
        <p className="mt-1 text-xs sm:text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {blurb}
        </p>
      )}

      {timeLeft ? (
        <div className="mt-3 flex flex-wrap justify-center gap-2 sm:gap-2.5">
          <TimeBlock value={timeLeft.days} label="Days" />
          <TimeBlock value={timeLeft.hours} label="Hours" />
          <TimeBlock value={timeLeft.minutes} label="Mins" />
          <TimeBlock value={timeLeft.seconds} label="Secs" />
        </div>
      ) : (
        <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--text-link)' }}>
          It’s live.
        </p>
      )}
    </motion.div>
  );
}
