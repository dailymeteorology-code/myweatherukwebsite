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
 * It used to hide on phones because the section header printed the countdown
 * there instead; the header lost that line in the glass redesign, so on a phone
 * there was no countdown at all. It shows at every width now, in the page's
 * glass rather than the old palette.
 */

/* Matches SLOT_MINUTES in server/functions/getMetOfficeWarnings.js. If that
   changes, this ring fills at the wrong rate — it is only the ring geometry,
   the countdown itself comes from `nextUpdate`, so a mismatch shows as a ring
   that fills early and then sits full rather than as a wrong time. */
const SLOT_MS = 10 * 60 * 1000;
const R = 9;
const CIRC = 2 * Math.PI * R;

export default function WarningsRefreshBadge({ lastUpdated, nextUpdate, source }) {
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
  const progress = Math.min(SLOT_MS, Math.max(0, SLOT_MS - remainingMs)) / SLOT_MS;

  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');

  const title =
    (source === 'nswws-api' ? 'Official Met Office warnings feed (NSWWS). ' : '') +
    /* Deliberately not naming the minutes: the point is that the schedule is
       the feed's, not yours, and a named cadence goes stale when it changes. */
    'Refreshes on the clock — opening the page does not trigger a fetch.' +
    (lastUpdated ? ` Last updated ${new Date(lastUpdated).toLocaleTimeString('en-GB')}.` : '');

  return (
    <div
      title={title}
      className="flex items-center gap-2 rounded-2xl px-2.5 py-1.5"
      style={{ background: 'var(--glass-fill)', border: '1px solid var(--glass-hairline)' }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" className="flex-shrink-0 -rotate-90" aria-hidden="true">
        <circle cx="12" cy="12" r={R} fill="none" strokeWidth="2.5" stroke="var(--glass-hairline)" />
        <circle
          cx="12"
          cy="12"
          r={R}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          stroke={due ? '#34d399' : 'var(--accent-uk)'}
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - progress)}
          style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s' }}
        />
      </svg>

      <span className="leading-tight">
        <span
          className="block text-[9px] font-bold uppercase tracking-[0.13em]"
          style={{ color: 'var(--ink-3)' }}
        >
          {due ? 'Refreshing' : 'Next update'}
        </span>
        <span
          className="block text-[12.5px] font-extrabold tabular-nums"
          style={{ color: 'var(--ink-1)' }}
        >
          {due ? 'now' : `${mm}:${ss}`}
        </span>
      </span>
    </div>
  );
}
