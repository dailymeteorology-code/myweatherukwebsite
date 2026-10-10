import React, { useState, useEffect } from 'react';

/* ── Live run countdown ─────────────────────────────────────────────────────
   Free-tier model runs are paced (~32 s between API batches), so a full run
   takes several minutes. This shows a live mm:ss countdown of the estimated
   remaining time so the admin knows it's working and roughly how long is left.
   The estimate is (batches × per-batch pace) + headroom for final scoring; it
   counts down to 0:00 and then shows "Finishing up…" until the real fetch
   resolves (actual time can vary slightly with retries / backoff). */
const FREE_TIER_POINTS_EST = 300;   // ~UK/Ireland points at 0.5°
const FREE_TIER_BATCH_SIZE = 25;    // matches BATCH_SIZE_NORMAL in openMeteoTCM
const FREE_TIER_PACE_MS    = 18000; // matches INTER_BATCH_DELAY_MS

function estimatedRunMs() {
  const batches = Math.ceil(FREE_TIER_POINTS_EST / FREE_TIER_BATCH_SIZE);
  // Delay applies only BETWEEN batches (batches − 1), plus headroom for the
  // final fetch + scoring maths.
  return (batches - 1) * FREE_TIER_PACE_MS + 8000;
}

export default function RunCountdown({ startTime }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const total = estimatedRunMs();
  const elapsed = startTime ? now - startTime : 0;
  const remaining = Math.max(0, total - elapsed);
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);
  const label = remaining > 0
    ? `~${mm}:${ss.toString().padStart(2, '0')} remaining`
    : 'Finishing up…';

  return (
    <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, color: '#38bdf8' }}>
      {label}
    </span>
  );
}