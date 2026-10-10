/* ════════════════════════════════════════════════════════════════════════════
   NEXT THREE HOURS — PRECIPITATION
   ────────────────────────────────────────────────────────────────────────────
   Ten-minute slots on the clock (…:00, :10, :20, :30, :40, :50, :00…), starting
   from the ten-minute mark the reader is standing in, running three hours.

   ON RESOLUTION, PLAINLY: the Met Office site-specific product publishes
   precipitation HOURLY. These slots are therefore a finer grid over an hourly
   forecast, not a ten-minute nowcast — every slot inside an hour carries that
   hour's chance and rate. The panel says so rather than implying a precision
   the data does not have; inventing variation between the slots would have
   looked more convincing and been a fabrication.

   It only appears when something is actually expected. A three-hour panel of
   flat zeroes is worse than no panel.
   ════════════════════════════════════════════════════════════════════════════ */
import React from 'react';
import { Droplets } from 'lucide-react';

const SLOT_MS = 10 * 60 * 1000;
const SLOTS = 18;                     // three hours
const SHOW_THRESHOLD = 15;            // % chance worth interrupting the page for

const KIND_COLOUR = {
  Rain: '#60a5fa', Sleet: '#a5b4fc', Snow: '#e2e8f0',
  Hail: '#67e8f9', Thunderstorm: '#fbbf24',
};

/** Describe a rate the way a forecast would say it. */
function intensityLabel(rate, chance) {
  if (rate == null) return chance >= 60 ? 'Likely' : chance >= 30 ? 'Possible' : 'Slight risk';
  if (rate >= 4) return 'Heavy';
  if (rate >= 1) return 'Moderate';
  if (rate > 0) return 'Light';
  return 'Dry';
}

/**
 * Build the slot grid.
 *
 * Exported for testing: the awkward parts are that the grid must land on clock
 * boundaries regardless of when it is built, and that each slot must pick up
 * the hour it actually falls inside rather than the nearest one.
 */
export function buildSlots(hours, now = Date.now(), count = SLOTS) {
  const start = Math.floor(now / SLOT_MS) * SLOT_MS;
  const withTimes = (hours || [])
    .filter(h => h.time)
    .map(h => ({ ...h, ms: new Date(h.time).getTime() }))
    .sort((a, b) => a.ms - b.ms);

  return Array.from({ length: count }, (_, i) => {
    const at = start + i * SLOT_MS;
    // The hour a slot belongs to is the latest one that has already begun.
    let hour = null;
    for (const h of withTimes) {
      if (h.ms <= at) hour = h; else break;
    }
    return {
      at,
      minute: new Date(at).getMinutes(),
      chance: hour?.rainChance ?? null,
      rate: hour?.precipRate ?? null,
      kind: hour?.precipKind || null,
    };
  });
}

export default function PrecipOutlook({ hours, now, formatTime }) {
  const slots = buildSlots(hours, now ?? Date.now());
  const peak = slots.reduce((m, s) => Math.max(m, s.chance ?? 0), 0);
  if (peak < SHOW_THRESHOLD) return null;

  const peakSlot = slots.find(s => (s.chance ?? 0) === peak);
  const kind = peakSlot?.kind || 'Rain';
  const colour = KIND_COLOUR[kind] || KIND_COLOUR.Rain;
  const maxRate = slots.reduce((m, s) => Math.max(m, s.rate ?? 0), 0);

  return (
    <div style={{
      margin: '0 0 14px', borderRadius: 16, overflow: 'hidden',
      background: 'rgba(0,0,0,0.22)', border: `1px solid ${colour}44`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px 8px', flexWrap: 'wrap' }}>
        <Droplets style={{ width: 15, height: 15, color: colour }} />
        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#fff' }}>
          {kind} in the next 3 hours
        </span>
        <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.6)' }}>
          peak {peak}%{maxRate > 0 ? ` · ${intensityLabel(maxRate, peak).toLowerCase()}` : ''}
        </span>
      </div>

      <div style={{ overflowX: 'auto', padding: '0 14px 10px' }}>
        <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', minWidth: SLOTS * 30 }}>
          {slots.map((s) => {
            const chance = s.chance ?? 0;
            const onHour = s.minute === 0;
            // Height carries the chance; opacity carries the rate, so a slot
            // that is likely-but-light reads differently from likely-and-heavy.
            const h = Math.max(4, (chance / 100) * 44);
            const strength = maxRate > 0 ? Math.min(1, (s.rate ?? 0) / maxRate) : chance / 100;
            return (
              <div key={s.at} style={{ flex: 1, minWidth: 26, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: '0.56rem', fontWeight: 700, color: chance >= SHOW_THRESHOLD ? colour : 'rgba(255,255,255,0.25)' }}>
                  {chance ? `${chance}%` : ''}
                </span>
                <div style={{ height: 48, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
                  <div style={{
                    width: '100%', height: h, borderRadius: 3,
                    background: colour,
                    opacity: chance ? 0.35 + strength * 0.65 : 0.12,
                  }} />
                </div>
                <span style={{
                  fontSize: '0.58rem', whiteSpace: 'nowrap',
                  color: onHour ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)',
                  fontWeight: onHour ? 700 : 400,
                }}>
                  {onHour && formatTime ? formatTime(new Date(s.at).toISOString()) : `:${String(s.minute).padStart(2, '0')}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <p style={{
        margin: 0, padding: '0 14px 10px', fontSize: '0.62rem', lineHeight: 1.45,
        color: 'rgba(255,255,255,0.4)',
      }}>
        The Met Office publishes precipitation hourly, so each ten-minute block shows
        its hour&rsquo;s figure rather than a ten-minute nowcast.
      </p>
    </div>
  );
}
