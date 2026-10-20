// Improved Day Selector Cards for WeatherPatterns page
// Cleaner, faster, more informative — single horizontal row on desktop,
// scrollable on mobile. Uses CSS transitions only (no per-card framer-motion)
// for much smoother re-renders when day data updates.

import React, { memo } from 'react';
import { CloudLightning, CloudRain, Wind, Zap } from 'lucide-react';

const RISK_META = [
  { level: 'No Risk',  min: 0 },
  { level: 'Very Low', min: 5 },
  { level: 'Low',      min: 12 },
  { level: 'Marginal', min: 22 },
  { level: 'Slight',   min: 35 },
  { level: 'Moderate', min: 50 },
  { level: 'High',     min: 65 },
  { level: 'Severe',   min: 80 },
];

function scoreToLevel(score) {
  for (let i = RISK_META.length - 1; i >= 0; i--) {
    if (score >= RISK_META[i].min) return RISK_META[i].level;
  }
  return 'No Risk';
}

const LEVEL_COLORS = {
  'No Risk':  { bg: 'rgba(100,116,139,0.10)', border: 'rgba(100,116,139,0.30)', text: '#94a3b8', accent: '#64748b' },
  'Very Low': { bg: 'rgba(27,94,32,0.18)',    border: 'rgba(27,94,32,0.55)',    text: '#4ade80', accent: '#1b5e20' },
  'Low':      { bg: 'rgba(46,125,50,0.22)',   border: 'rgba(46,125,50,0.65)',   text: '#22c55e', accent: '#2e7d32' },
  'Marginal': { bg: 'rgba(130,119,23,0.25)',  border: 'rgba(130,119,23,0.70)',  text: '#facc15', accent: '#827717' },
  'Slight':   { bg: 'rgba(230,81,0,0.28)',    border: 'rgba(230,81,0,0.75)',    text: '#fb923c', accent: '#e65100' },
  'Moderate': { bg: 'rgba(198,40,40,0.30)',   border: 'rgba(198,40,40,0.80)',   text: '#f87171', accent: '#c62828' },
  'High':     { bg: 'rgba(106,27,154,0.32)',  border: 'rgba(106,27,154,0.85)',  text: '#c084fc', accent: '#6a1b9a' },
  'Severe':   { bg: 'rgba(26,0,51,0.40)',     border: 'rgba(26,0,51,0.95)',     text: '#e9d5ff', accent: '#1a0033' },
};

const RISK_ICONS = {
  thunderstorm: { Icon: CloudLightning, color: '#e65100', label: 'Storm' },
  hail:         { Icon: CloudRain,      color: '#2e7d32', label: 'Hail'  },
  tornado:      { Icon: Wind,           color: '#827717', label: 'Tor'   },
  lightning:    { Icon: Zap,            color: '#6a1b9a', label: 'Ltg'   },
};

const DayCard = memo(function DayCard({ dayIdx, isActive, date, summary, riskType, onClick, theme, isLoading }) {
  const score = summary?.[riskType] ?? null;
  const level = score != null ? scoreToLevel(score) : 'No Risk';
  const pal   = LEVEL_COLORS[level];
  const { Icon } = RISK_ICONS[riskType] ?? RISK_ICONS.thunderstorm;

  const dayName = dayIdx === 0 ? 'Today' : dayIdx === 1 ? 'Tomorrow' : date.toLocaleDateString(undefined, { weekday: 'short' });
  const dateStr = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const fullWeekday = date.toLocaleDateString(undefined, { weekday: 'long' });

  return (
    <button
      onClick={onClick}
      className="tcm-day-card"
      data-active={isActive}
      style={{
        '--card-border': pal.border,
        '--card-bg': isActive ? pal.bg : 'rgba(255,255,255,0.025)',
        '--card-text': pal.text,
        '--card-accent': pal.accent,
        border: `2px solid ${isActive ? pal.border : theme.cardBorder}`,
        background: isActive ? `linear-gradient(135deg, ${pal.bg}, rgba(255,255,255,0.02))` : 'rgba(255,255,255,0.025)',
        color: theme.textPrimary,
      }}
    >
      <div className="tcm-day-card__top-strip" style={{ background: isActive ? `linear-gradient(90deg, ${pal.accent}, ${pal.accent}55)` : 'transparent' }}/>

      <div className="tcm-day-card__header">
        <div>
          <div className="tcm-day-card__day-label" style={{ color: isActive ? pal.text : theme.textMuted }}>
            {dayName}
          </div>
          <div className="tcm-day-card__weekday" style={{ color: theme.textPrimary }}>
            {dayIdx <= 1 ? fullWeekday : dateStr}
          </div>
          {dayIdx <= 1 && (
            <div className="tcm-day-card__date" style={{ color: theme.textMuted }}>
              {dateStr}
            </div>
          )}
        </div>
        <Icon style={{ width: 18, height: 18, color: isActive ? pal.text : theme.textMuted, flexShrink: 0, opacity: 0.85 }}/>
      </div>

      {isLoading && score == null ? (
        <div className="tcm-day-card__skeleton">
          <div className="tcm-day-card__skeleton-line" style={{ width: '60%' }}/>
          <div className="tcm-day-card__skeleton-line" style={{ width: '40%' }}/>
        </div>
      ) : (
        <div className="tcm-day-card__body">
          <div className="tcm-day-card__level-badge" style={{
            background: pal.bg,
            border: `1.5px solid ${pal.border}`,
            color: pal.text,
          }}>
            <span className="tcm-day-card__dot" style={{ background: pal.accent, boxShadow: `0 0 6px ${pal.accent}` }}/>
            {level}
          </div>
          <div className="tcm-day-card__score" style={{ color: theme.textPrimary }}>
            {score ?? '—'}
            <span style={{ fontSize: '0.6rem', color: theme.textMuted, fontWeight: 600, marginLeft: 2 }}>/100</span>
          </div>
        </div>
      )}

      {/* Mini risk-type sparkline */}
      {summary && (
        <div className="tcm-day-card__sparkline">
          {['thunderstorm', 'hail', 'tornado', 'lightning'].map(rt => {
            const s = summary[rt] ?? 0;
            const meta = RISK_ICONS[rt];
            return (
              <div key={rt} className="tcm-day-card__spark-row" title={`${meta.label}: ${s}`}>
                <span style={{ color: theme.textMuted, fontSize: '0.52rem', width: 22, textTransform: 'uppercase', fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>
                  {meta.label}
                </span>
                <div className="tcm-day-card__spark-track">
                  <div className="tcm-day-card__spark-fill" style={{ width: `${Math.min(100, s)}%`, background: meta.color }}/>
                </div>
                <span style={{ color: s > 10 ? meta.color : theme.textMuted, fontSize: '0.55rem', fontFamily: "'DM Mono',monospace", width: 16, textAlign: 'right' }}>
                  {Math.round(s)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </button>
  );
});

export default function DaySelectorCards({ value, onChange, run, summary, riskType, theme, isLoading, daysAvailable = 3 }) {
  // How many days have actually been computed (the outlook is a 3-day run).
  const available = Math.max(1, Math.min(3, daysAvailable || 3));
  return (
    <>
      <style>{`
        .tcm-day-selector {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          width: 100%;
        }
        .tcm-day-card {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 12px;
          border-radius: 14px;
          cursor: pointer;
          text-align: left;
          font-family: 'DM Sans', system-ui, sans-serif;
          overflow: hidden;
          transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease;
          min-width: 0;
        }
        .tcm-day-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.18);
        }
        .tcm-day-card[data-active="true"] {
          box-shadow: 0 0 0 1px var(--card-border), 0 8px 28px rgba(0,0,0,0.22);
        }
        .tcm-day-card__top-strip {
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 3px;
          border-radius: 14px 14px 0 0;
        }
        .tcm-day-card__header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 6px;
        }
        .tcm-day-card__day-label {
          font-size: 0.62rem;
          font-weight: 800;
          letter-spacing: 0.10em;
          text-transform: uppercase;
          font-family: 'DM Mono', monospace;
          margin-bottom: 2px;
        }
        .tcm-day-card__weekday {
          font-size: 0.95rem;
          font-weight: 800;
          line-height: 1.15;
        }
        .tcm-day-card__date {
          font-size: 0.68rem;
          margin-top: 1px;
          font-weight: 500;
        }
        .tcm-day-card__body {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        .tcm-day-card__level-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 8px;
          border-radius: 99px;
          font-size: 0.66rem;
          font-weight: 800;
          letter-spacing: 0.02em;
        }
        .tcm-day-card__dot {
          width: 6px;
          height: 6px;
          border-radius: 99px;
          flex-shrink: 0;
        }
        .tcm-day-card__score {
          font-size: 1.05rem;
          font-weight: 800;
          font-family: 'DM Mono', monospace;
          line-height: 1;
        }
        .tcm-day-card__sparkline {
          display: flex;
          flex-direction: column;
          gap: 3px;
          margin-top: 2px;
        }
        .tcm-day-card__spark-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .tcm-day-card__spark-track {
          flex: 1;
          height: 3px;
          background: rgba(255,255,255,0.06);
          border-radius: 99px;
          overflow: hidden;
          min-width: 0;
        }
        .tcm-day-card__spark-fill {
          height: 100%;
          border-radius: 99px;
          transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .tcm-day-card__skeleton {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 4px 0;
        }
        .tcm-day-card__skeleton-line {
          height: 10px;
          border-radius: 4px;
          background: linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.10), rgba(255,255,255,0.04));
          background-size: 200% 100%;
          animation: tcm-skeleton 1.4s ease-in-out infinite;
        }
        @keyframes tcm-skeleton {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @media (max-width: 720px) {
          .tcm-day-selector {
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
          }
        }
        @media (max-width: 420px) {
          .tcm-day-card { padding: 10px; }
          .tcm-day-card__weekday { font-size: 0.85rem; }
          .tcm-day-card__score { font-size: 0.95rem; }
        }
      `}</style>
      <div className="tcm-day-selector">
        {[0, 1, 2].map(d => {
          const date = new Date(run);
          date.setDate(date.getDate() + d);
          const locked = d >= available;   // not computed yet
          return (
            <div key={d} style={locked ? { opacity: 0.4, pointerEvents: 'none', filter: 'grayscale(0.6)' } : undefined}
                 title={locked ? `Day ${d + 1} not computed yet — press Continue` : undefined}>
              <DayCard
                dayIdx={d}
                isActive={value === d}
                date={date}
                summary={summary?.[d]}
                riskType={riskType}
                onClick={() => { if (!locked) onChange(d); }}
                theme={theme}
                isLoading={isLoading}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}