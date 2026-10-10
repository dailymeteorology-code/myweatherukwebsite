import React, { useState, useEffect } from 'react';

/**
 * Countdown to the next warnings refresh.
 *
 * Warnings are fetched on the clock, on a fixed slot, and never because someone
 * opened the page, so this is the same for every visitor — it is a property of
 * the feed, not of your session. That is worth showing: without it, a quiet
 * warnings panel is ambiguous between "nothing is in force" and "this page has
 * gone stale".
 *
 * The section header already prints "Updated HH:MM" as its subtitle, and prints
 * the countdown itself on mobile via `mobileSubtitle` — but that subtitle lives
 * in an `sm:hidden` block, so on desktop there was no countdown at all. This
 * fills that gap and stays out of the way below the `sm` breakpoint.
 */
export default function WarningsRefreshBadge({
  lastUpdated, nextUpdate, source,
  /* The radar reuses this badge so both feeds count down the same way instead
     of each inventing its own "Next update in 3:07" text. Its slot is five
     minutes rather than thirty, and it is a different feed with a different
     cadence, so the ring length and the tooltip are parameters now. */
  /* Matches SLOT_MINUTES in server/functions/getMetOfficeWarnings.js. If that
     changes, this ring fills at the wrong rate — it is only the ring geometry,
     the countdown itself comes from `nextUpdate`, so a mismatch shows as a
     ring that fills early and then sits full rather than as a wrong time. */
  slotMs = 10 * 60 * 1000,
  title: titleOverride,
  /* The warnings badge hides below `sm` because the section header prints the
     countdown there instead. The radar has no such fallback, so it opts in. */
  alwaysVisible = false,
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!nextUpdate) return null;

  const target = nextUpdate instanceof Date ? nextUpdate.getTime() : new Date(nextUpdate).getTime();
  if (!Number.isFinite(target)) return null;

  const remainingMs = target - now;
  const due = remainingMs <= 0;

  // The ring fills as the feed's slot elapses.
  const elapsed = Math.min(slotMs, Math.max(0, slotMs - remainingMs));
  const progress = elapsed / slotMs;

  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');

  const R = 9;
  const CIRC = 2 * Math.PI * R;

  const title = titleOverride ??
    ((source === 'nswws-api'
      ? 'Official Met Office warnings feed (NSWWS). '
      : '') +
    /* Deliberately not naming the minutes. This said ":00 and :30" and went
       stale the moment the cadence changed; the point it is making is that the
       schedule is the feed's, not yours. */
    'Refreshes on the clock — opening the page does not trigger a fetch.' +
    (lastUpdated ? ` Last updated ${new Date(lastUpdated).toLocaleTimeString('en-GB')}.` : ''));

  return (
    <div
      title={title}
      className={`${alwaysVisible ? 'flex' : 'hidden sm:flex'} items-center gap-2 rounded-2xl px-2.5 py-1.5 backdrop-blur-sm`}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" className="flex-shrink-0 -rotate-90">
        <circle cx="12" cy="12" r={R} fill="none" strokeWidth="2.5" stroke="var(--border)" />
        <circle
          cx="12"
          cy="12"
          r={R}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          stroke={due ? '#34d399' : '#38bdf8'}
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - progress)}
          style={{
            transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s',
            filter: due ? 'drop-shadow(0 0 4px rgba(52,211,153,0.7))' : 'none',
          }}
        />
      </svg>

      <span className="leading-tight">
        <span
          className="block text-[9px] font-bold uppercase tracking-[0.13em]"
          style={{ color: 'var(--text-muted)' }}
        >
          {due ? 'Refreshing' : 'Next update'}
        </span>
        <span
          className="block text-[12.5px] font-extrabold tabular-nums"
          style={{ color: 'var(--text-primary)' }}
        >
          {due ? 'now' : `${mm}:${ss}`}
        </span>
      </span>
    </div>
  );
}
