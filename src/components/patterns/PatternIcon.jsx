/* Day symbols for the Weather Patterns page: sun, fair, cloud, showers, rain, heavy rain and snow,
   plus a gust mark the day strip shows beside a windy day. Cloud and gust colours come from the
   page's tokens so they read on light and dark glass. */
import React from 'react';

const Sun = ({ cx = 16, cy = 16, r = 6.2, rays = true }) => (
  <g>
    {rays && Array.from({ length: 8 }, (_, k) => {
      const a = (k * Math.PI) / 4, r0 = r + 2.6, r1 = r + 5.2;
      return <line key={k} x1={cx + r0 * Math.cos(a)} y1={cy + r0 * Math.sin(a)} x2={cx + r1 * Math.cos(a)} y2={cy + r1 * Math.sin(a)}
        stroke="#f6b23c" strokeWidth="2" strokeLinecap="round" />;
    })}
    <circle cx={cx} cy={cy} r={r} fill="url(#wpi-sun)" />
  </g>
);
const Cloud = ({ x = 0, y = 0, s = 1, dark = false }) => (
  <path transform={`translate(${x} ${y}) scale(${s})`} fill={dark ? 'var(--wp-cloud-dark)' : 'var(--wp-cloud)'}
    d="M9.5 24h14a5.5 5.5 0 0 0 .6-10.97A7.5 7.5 0 0 0 9.9 11.6 6.2 6.2 0 0 0 9.5 24z" />
);
const Drops = ({ n, heavy }) => (
  <g stroke="#4b9bf0" strokeWidth={heavy ? 2.3 : 1.9} strokeLinecap="round">
    {Array.from({ length: n }, (_, k) => {
      const x = 11 + k * (n === 2 ? 8 : 5.5);
      return <line key={k} x1={x} y1="26" x2={x - 1.6} y2={heavy ? 31 : 29.5} />;
    })}
  </g>
);
const Flakes = () => (
  <g fill="#9cc8ff">
    {[[11, 28], [17, 30], [23, 28]].map(([x, y], k) => <circle key={k} cx={x} cy={y} r="1.7" />)}
  </g>
);
export function GustIcon({ size = 14, title = 'Windy' }) {
  return (
    <svg className="wp-gust" width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={title}>
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M1.5 6h8.2a2.3 2.3 0 1 0-2.3-2.3" />
        <path d="M1.5 10h11a2.1 2.1 0 1 1-2.1 2.1" />
      </g>
    </svg>
  );
}

export default function PatternIcon({ kind, size = 30, title }) {
  return (
    <svg className="wp-icon" width={size} height={size} viewBox="0 0 32 34" role="img" aria-label={title || kind}>
      <defs>
        <radialGradient id="wpi-sun" cx="40%" cy="38%" r="70%">
          <stop offset="0" stopColor="#ffe08a" /><stop offset="1" stopColor="#f6a823" />
        </radialGradient>
      </defs>
      {kind === 'sun' && <Sun />}
      {kind === 'fair' && (<><Sun cx={12} cy={11.5} r={5.2} /><Cloud x={4} y={3} s={0.86} /></>)}
      {kind === 'cloud' && (<><Cloud x={-4} y={-4} s={0.8} dark /><Cloud x={2} y={1} s={0.9} /></>)}
      {kind === 'showers' && (<><Sun cx={11} cy={9} r={4.6} rays={false} /><Cloud x={2} y={-2} s={0.95} /><Drops n={2} /></>)}
      {kind === 'rain' && (<><Cloud x={0} y={-3} s={1} /><Drops n={3} /></>)}
      {kind === 'heavy' && (<><Cloud x={0} y={-3} s={1} dark /><Drops n={3} heavy /></>)}
      {kind === 'snow' && (<><Cloud x={0} y={-3} s={1} /><Flakes /></>)}
    </svg>
  );
}
