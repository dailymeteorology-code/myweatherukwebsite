import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

/**
 * RunWaitCountdown — shows an estimated remaining wait time while a model run
 * is in progress. The estimate is computed by the caller from the SAME batching
 * and pacing maths the fetch engine uses (see estimateRunSeconds), so it tracks
 * the real run length rather than a fixed guess — and it differs each time as
 * region, grid size and day depth change.
 *
 * Mount this only while the run is actually running, and key it on the run start
 * so it resets each time. It is purely presentational — it never affects the run.
 *
 * Props:
 *   estimateSeconds — expected wall-clock seconds for this run (required).
 */
export default function RunWaitCountdown({ estimateSeconds = 35, muted = '#94a3b8', accent = '#818cf8' }) {
  const total = Math.max(5, Math.round(estimateSeconds));
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(id);
  }, []);

  const left = Math.max(0, total - elapsed);
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const pct = Math.min(100, Math.round((elapsed / total) * 100));

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, fontFamily: "'DM Mono',monospace" }}>
      <Clock style={{ width: 11, height: 11, color: accent, flexShrink: 0 }} />
      {left > 0 ? (
        <span style={{ fontSize: '0.62rem', color: muted }}>
          Estimated wait: <span style={{ color: accent, fontWeight: 700 }}>{mmss}</span> · {pct}%
        </span>
      ) : (
        <span style={{ fontSize: '0.62rem', color: accent, fontWeight: 700 }}>
          Finishing up — any moment now…
        </span>
      )}
    </div>
  );
}