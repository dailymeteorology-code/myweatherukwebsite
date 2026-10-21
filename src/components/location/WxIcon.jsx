/* Weather symbols for the Location page, in the Apple Weather manner: flat multicolour shapes
   (a warm sun, white and grey clouds, blue rain, white snow, a yellow bolt) on a 64-unit grid,
   with day and night versions. Drawn here from simple primitives; nothing is borrowed.

   Where one shape sits behind another (a sun or moon behind a cloud, a cloud behind a cloud)
   the one behind is cut back by a thin gap round the front one, the way Apple's symbols are
   drawn, so the shapes never smudge into each other. What falls is spaced so no two flakes,
   stones or drops touch, and nothing touches the cloud above it.

   `cond` is a weather type from src/lib/ukvLocation.js classify(), or 'sunrise' / 'sunset'.
   `windy` adds the wind: the symbol steps back a little and two gusts curl out beneath it, so
   any weather can say it is windy. 'windy' on its own is three gusts; a blizzard has its wind
   drawn in. */
import React, { useId } from 'react';

const CLOUD_TONES = {
  white: ['#FFFFFF', '#DCE3EB'],
  back: ['#EEF2F6', '#BFC9D4'],
  grey: ['#C9D2DC', '#97A3B1'],
  dark: ['#9AA6B4', '#66727F'],
};

function Grad({ id, from, to, y1 = 0, y2 = 64 }) {
  return (
    <linearGradient id={id} x1="0" y1={y1} x2="0" y2={y2} gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor={from} />
      <stop offset="1" stopColor={to} />
    </linearGradient>
  );
}

/* a cloud's outline: three lobes and a flat base in a 48 x 30 box */
const Lobes = () => (
  <>
    <circle cx="12" cy="20" r="10" />
    <circle cx="25" cy="14" r="13" />
    <circle cx="37" cy="19" r="11" />
    <rect x="12" y="19" width="25" height="11" />
  </>
);

function Cloud({ x = 8, y = 20, s = 1, tone = 'white', uid }) {
  const id = `${uid}c${tone}${x}${y}`;
  const [a, b] = CLOUD_TONES[tone];
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <defs><Grad id={id} from={a} to={b} y1={1} y2={30} /></defs>
      <g fill={`url(#${id})`}><Lobes /></g>
    </g>
  );
}

/* whatever is drawn inside, cut back by a gap round a cloud at (x, y, s) */
function Behind({ uid, x, y, s, gap = 3, children }) {
  const id = `${uid}gap${x}${y}`;
  return (
    <>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="-16" y="-16" width="96" height="96">
          <rect x="-16" y="-16" width="96" height="96" fill="#fff" />
          <g transform={`translate(${x} ${y}) scale(${s})`} fill="#000" stroke="#000" strokeWidth={(2 * gap) / s}><Lobes /></g>
        </mask>
      </defs>
      <g mask={`url(#${id})`}>{children}</g>
    </>
  );
}

function Sun({ cx = 32, cy = 32, r = 12, uid, rays = true }) {
  const id = `${uid}sun${cx}${cy}`;
  return (
    <g>
      <defs>
        <radialGradient id={id} cx={cx - r * 0.3} cy={cy - r * 0.35} r={r * 1.4} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFE873" />
          <stop offset="1" stopColor="#FFB31A" />
        </radialGradient>
      </defs>
      {rays && [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180);
        return <line key={a} x1={cx + c * (r + 4.5)} y1={cy + s * (r + 4.5)} x2={cx + c * (r + 9)} y2={cy + s * (r + 9)} stroke="#FFC22E" strokeWidth={r / 3.6} strokeLinecap="round" />;
      })}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} />
    </g>
  );
}

function Moon({ cx = 32, cy = 30, r = 15, uid, stars = false }) {
  const id = `${uid}moon${cx}${cy}`, m = `${uid}mm${cx}${cy}`;
  return (
    <g>
      <defs>
        <Grad id={id} from="#FFFFFF" to="#E7E2CC" y1={cy - r} y2={cy + r} />
        <mask id={m}>
          <rect x="-16" y="-16" width="96" height="96" fill="#fff" />
          <circle cx={cx + r * 0.62} cy={cy - r * 0.42} r={r * 0.86} fill="#000" />
        </mask>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} mask={`url(#${m})`} />
      {stars && (
        <g fill="#FFFFFF">
          <path d="M48 10l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z" />
          <path d="M55 23l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" opacity="0.8" />
        </g>
      )}
    </g>
  );
}

/* what falls, under a cloud whose base is at about y = 45 (everything starts at 49 or below) */
const Rain = ({ n = 3, heavy = false }) => {
  const xs = n === 2 ? [25, 37] : n === 3 ? [20, 32, 44] : [17, 27, 37, 47];
  const len = heavy ? 9 : 7;
  return (
    <g stroke={heavy ? '#2E8CFF' : '#4CB0FF'} strokeWidth={heavy ? 3.4 : 3.1} strokeLinecap="round">
      {xs.map((x, i) => <line key={x} x1={x} y1={51 + (i % 2) * 3} x2={x - 2.6} y2={51 + (i % 2) * 3 + len} />)}
    </g>
  );
};
const Drizzle = () => (
  <g fill="#5CB8FF">{[[21, 52], [32, 52], [43, 52], [26.5, 60], [37.5, 60]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.9" />)}</g>
);
const Flake = ({ x, y, r = 3.6 }) => (
  <g stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round">
    {[90, 30, 150].map((a) => {
      const c = Math.cos((a * Math.PI) / 180) * r, s = Math.sin((a * Math.PI) / 180) * r;
      return <line key={a} x1={x - c} y1={y - s} x2={x + c} y2={y + s} />;
    })}
  </g>
);
/* flakes 12-14 units apart in staggered rows: their 3.6-unit arms never meet */
const SNOW = {
  2: [[25, 54], [39, 57]],
  3: [[19, 54], [32, 58], [45, 54]],
  5: [[18, 53], [32, 53], [46, 53], [25, 61], [39, 61]],
};
const Snow = ({ n = 3 }) => <g>{SNOW[n].map(([x, y]) => <Flake key={`${x}${y}`} x={x} y={y} />)}</g>;
const Hail = () => (
  <g fill="#FFFFFF" stroke="#9BCBFF" strokeWidth="1.3">
    {[[20, 52], [32, 52], [44, 52], [26, 60], [38, 60]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="2.6" />)}
  </g>
);
const Sleet = () => (
  <>
    <g stroke="#4CB0FF" strokeWidth="3.1" strokeLinecap="round">
      <line x1="20" y1="51" x2="17.4" y2="58" />
      <line x1="46" y1="51" x2="43.4" y2="58" />
    </g>
    <Flake x={32} y={56} />
  </>
);
/* the bolt starts just below the cloud's base (y = 43, cloud base at 40) */
const Bolt = () => <path d="M33 43 L24.5 55 H31 L27.5 64 L40.5 50 H33.5 L37 43 Z" fill="#FFD60A" stroke="#F5B400" strokeWidth="0.8" strokeLinejoin="round" />;
const FogLines = ({ y = 46 }) => (
  <g fill="#D3DBE4">
    <rect x="10" y={y} width="44" height="4" rx="2" />
    <rect x="16" y={y + 7} width="38" height="4" rx="2" opacity="0.85" />
    <rect x="10" y={y + 14} width="32" height="4" rx="2" opacity="0.7" />
  </g>
);

/* gusts: a line with a curl at its end (up or down), in the pale grey of the clouds */
const GUST = '#E3EAF2';
const Gust = ({ x, y, len, r, up = true, w = 3 }) => (
  <path d={`M${x} ${y} H${x + len} a${r} ${r} 0 1 ${up ? 0 : 1} ${-r} ${up ? -r : r}`} fill="none" stroke={GUST} strokeWidth={w} strokeLinecap="round" />
);
/* the wind under any symbol (the symbol itself is drawn at 80 % above it) */
const WindMark = () => (
  <g>
    <Gust x={33} y={51} len={21} r={4.5} up />
    <Gust x={27} y={58.5} len={29} r={4} up={false} />
  </g>
);
/* torrential rain: five long, heavy streaks in two staggered rows */
const Torrent = () => (
  <g stroke="#1F6FEB" strokeWidth="3.6" strokeLinecap="round">
    {[14, 23, 32, 41, 50].map((x, i) => <line key={x} x1={x} y1={47 + (i % 2) * 3} x2={x - 3.6} y2={47 + (i % 2) * 3 + 12} />)}
  </g>
);
/* freezing rain: cold rain, an ice crystal, and the glaze it leaves */
const FreezingRain = () => (
  <>
    <g stroke="#7DD3FC" strokeWidth="3" strokeLinecap="round">
      <line x1="19" y1="50" x2="16.6" y2="56.5" />
      <line x1="45" y1="50" x2="42.6" y2="56.5" />
    </g>
    <g stroke="#BAE6FD" strokeWidth="1.7" strokeLinecap="round">
      {[90, 30, 150].map((a) => { const c = Math.cos((a * Math.PI) / 180) * 3.6, n = Math.sin((a * Math.PI) / 180) * 3.6; return <line key={a} x1={32 - c} y1={54 - n} x2={32 + c} y2={54 + n} />; })}
    </g>
    <rect x="14" y="61" width="36" height="2.6" rx="1.3" fill="#BAE6FD" />
  </>
);
/* a blizzard: snow driven sideways through the wind */
const Blizzard = () => (
  <>
    <Gust x={7} y={47.5} len={22} r={4} up w={2.8} />
    <Gust x={20} y={58} len={26} r={4} up={false} w={2.8} />
    <Flake x={41} y={48} r={3.3} />
    <Flake x={52} y={56} r={3.3} />
    <Flake x={11} y={57} r={3.3} />
  </>
);
/* heat haze under a hot sun */
const Haze = () => (
  <g fill="none" stroke="#FF8A3D" strokeWidth="2.6" strokeLinecap="round">
    {[48, 55].map((y, i) => <path key={y} d={`M${14 + i * 5} ${y} q4 -3.5 8 0 t8 0 t8 0 t8 0`} />)}
  </g>
);
/* the sun on the horizon, an arrow up for sunrise and down for sunset */
const Horizon = ({ up, uid }) => {
  const clip = `${uid}hz`;
  return (
    <>
      <defs><clipPath id={clip}><rect x="-8" y="-8" width="80" height="54.5" /></clipPath></defs>
      <g clipPath={`url(#${clip})`}><Sun cx={32} cy={47} r={11} uid={uid} /></g>
      <line x1="7" y1="49.5" x2="57" y2="49.5" stroke="#E3EAF2" strokeWidth="3.2" strokeLinecap="round" />
      <path d={up ? 'M32 22 V6 M25.5 12.5 L32 6 L38.5 12.5' : 'M32 6 V22 M25.5 15.5 L32 22 L38.5 15.5'} fill="none" stroke="#FFC22E" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
};

/* the sky body peeking out behind a cloud: a sun by day, a moon by night */
const Peek = ({ day, uid, cx = 24, cy = 22, r = 10 }) => (day ? <Sun cx={cx} cy={cy} r={r} uid={uid} /> : <Moon cx={cx} cy={cy} r={r + 1} uid={uid} />);

/* a sun or moon partly behind a cloud, with the gap between them */
const PeekBehind = ({ day, uid, peek, cloud, tone = 'white' }) => (
  <>
    <Behind uid={uid} {...cloud}><Peek day={day} uid={uid} {...peek} /></Behind>
    <Cloud {...cloud} tone={tone} uid={uid} />
  </>
);
/* two clouds, the back one cut back round the front one */
const TwoClouds = ({ uid, back = 'back', front = 'white' }) => {
  const f = { x: 6, y: 22, s: 1 };
  return (
    <>
      <Behind uid={uid} {...f}><Cloud x={19} y={9} s={0.8} tone={back} uid={uid} /></Behind>
      <Cloud {...f} tone={front} uid={uid} />
    </>
  );
};
const SHOWER_PEEK = { cx: 22, cy: 21, r: 9.5 };
const SHOWER_CLOUD = { x: 12, y: 18, s: 0.92 };

export default function WxIcon({ cond = 'cloudy', day = true, windy = false, size = 32, title, style }) {
  const uid = useId().replace(/:/g, '');
  let body;
  switch (cond) {
    case 'clear':
      body = day ? <Sun cx={32} cy={32} r={13} uid={uid} /> : <Moon cx={30} cy={33} r={17} uid={uid} stars />;
      break;
    case 'mostlyClear':
      body = (
        <>
          <Behind uid={uid} x={26} y={34} s={0.7}>{day ? <Sun cx={26} cy={25} r={12} uid={uid} /> : <Moon cx={26} cy={25} r={14} uid={uid} stars />}</Behind>
          <Cloud x={26} y={34} s={0.7} uid={uid} />
        </>
      );
      break;
    case 'partly':
      body = <PeekBehind day={day} uid={uid} peek={{ cx: 23, cy: 22, r: 11 }} cloud={{ x: 12, y: 25, s: 0.95 }} />;
      break;
    case 'cloudy':
      body = <Cloud x={6} y={17} s={1.08} uid={uid} />;
      break;
    case 'overcast':
      body = <TwoClouds uid={uid} back="grey" front="back" />;
      break;
    case 'fog':
      body = (<><Cloud x={10} y={6} s={0.92} tone="back" uid={uid} /><FogLines y={40} /></>);
      break;
    case 'mist':
      body = (<><Peek day={day} uid={uid} cx={32} cy={19} r={9} /><FogLines y={40} /></>);
      break;
    case 'drizzle':
      body = (<><Cloud x={8} y={15} s={1} tone="back" uid={uid} /><Drizzle /></>);
      break;
    case 'lightRain':
      body = (<><Cloud x={8} y={15} s={1} tone="back" uid={uid} /><Rain n={2} /></>);
      break;
    case 'rain':
      body = (<><Cloud x={8} y={15} s={1} tone="grey" uid={uid} /><Rain n={3} /></>);
      break;
    case 'heavyRain':
      body = (<><Cloud x={8} y={15} s={1} tone="dark" uid={uid} /><Rain n={4} heavy /></>);
      break;
    case 'showers':
      body = (<><PeekBehind day={day} uid={uid} peek={SHOWER_PEEK} cloud={SHOWER_CLOUD} /><Rain n={2} /></>);
      break;
    case 'heavyShowers':
      body = (<><PeekBehind day={day} uid={uid} peek={SHOWER_PEEK} cloud={SHOWER_CLOUD} tone="grey" /><Rain n={3} heavy /></>);
      break;
    case 'torrentialRain':
      body = (<><Cloud x={8} y={12} s={1} tone="dark" uid={uid} /><Torrent /></>);
      break;
    case 'freezingRain':
      body = (<><Cloud x={8} y={14} s={1} tone="back" uid={uid} /><FreezingRain /></>);
      break;
    case 'blizzard':
      body = (<><Cloud x={10} y={8} s={0.95} tone="grey" uid={uid} /><Blizzard /></>);
      break;
    case 'windy':
      body = (
        <>
          <Gust x={8} y={24} len={30} r={7} up w={3.6} />
          <Gust x={8} y={35} len={40} r={6} up={false} w={3.6} />
          <Gust x={14} y={46} len={22} r={5} up={false} w={3.6} />
        </>
      );
      break;
    case 'hot':
      body = day
        ? (<><Sun cx={32} cy={26} r={13} uid={uid} /><Haze /></>)
        : <Moon cx={30} cy={33} r={17} uid={uid} stars />;
      break;
    case 'thunderShowers':
      body = (
        <>
          <PeekBehind day={day} uid={uid} peek={SHOWER_PEEK} cloud={SHOWER_CLOUD} tone="grey" />
          <g transform="translate(4 3)"><Bolt /></g>
        </>
      );
      break;
    case 'sunrise':
    case 'sunset':
      body = <Horizon up={cond === 'sunrise'} uid={uid} />;
      break;
    case 'thunder':
      body = (
        <>
          <Cloud x={8} y={10} s={1} tone="dark" uid={uid} />
          <Bolt />
          <g stroke="#4CB0FF" strokeWidth="3" strokeLinecap="round"><line x1="17" y1="47" x2="14.4" y2="54" /><line x1="48" y1="47" x2="45.4" y2="54" /></g>
        </>
      );
      break;
    case 'sleet':
      body = (<><Cloud x={8} y={15} s={1} tone="back" uid={uid} /><Sleet /></>);
      break;
    case 'snow':
      body = (<><Cloud x={8} y={15} s={1} tone="back" uid={uid} /><Snow n={3} /></>);
      break;
    case 'heavySnow':
      body = (<><Cloud x={8} y={14} s={1} tone="grey" uid={uid} /><Snow n={5} /></>);
      break;
    case 'snowShowers':
      body = (<><PeekBehind day={day} uid={uid} peek={SHOWER_PEEK} cloud={SHOWER_CLOUD} /><Snow n={2} /></>);
      break;
    case 'hail':
      body = (<><Cloud x={8} y={14} s={1} tone="grey" uid={uid} /><Hail /></>);
      break;
    default:
      body = <Cloud x={6} y={18} s={1.05} uid={uid} />;
  }
  const marked = windy && !['windy', 'blizzard', 'sunrise', 'sunset'].includes(cond);
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={title || cond} style={{ flexShrink: 0, overflow: 'visible', ...style }}>
      {marked ? <><g transform="scale(0.8)">{body}</g><WindMark /></> : body}
    </svg>
  );
}
