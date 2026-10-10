/**
 * Conceptual setup diagrams. These are ILLUSTRATIONS of how a process works,
 * drawn schematically — not maps of real data and not forecasts. Every one
 * carries that label, as the brief requires.
 */
import React from 'react';

const C = {
  ink: 'var(--ink)', ink2: 'var(--ink2)', line: 'var(--line2)', warm: '#ff8a5b', hot: '#ff5d6c', cold: '#6fb6ff', cool: '#9ad0ff',
  green: '#4fbf7a', sea: '#2f6fb3', land: '#5b8f5b', cloud: '#cfd8e6', rain: '#5aa9ff', snow: '#ffffff', jet: '#a98bff',
};
const T = ({ x, y, children, size = 11, anchor = 'middle', fill = C.ink, weight = 600 }) => (
  <text x={x} y={y} fontSize={size} textAnchor={anchor} fill={fill} fontWeight={weight} fontFamily="DM Sans, sans-serif">{children}</text>
);
const Arrow = ({ x1, y1, x2, y2, color = C.ink2, w = 2 }) => {
  const a = Math.atan2(y2 - y1, x2 - x1); const h = 7;
  return (
    <g stroke={color} strokeWidth={w} fill="none" strokeLinecap="round">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <path d={`M${x2} ${y2} L${x2 - h * Math.cos(a - 0.45)} ${y2 - h * Math.sin(a - 0.45)} M${x2} ${y2} L${x2 - h * Math.cos(a + 0.45)} ${y2 - h * Math.sin(a + 0.45)}`} />
    </g>
  );
};
const Cloud = ({ x, y, s = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`} fill={C.cloud} opacity="0.9">
    <circle cx="0" cy="0" r="14" /><circle cx="16" cy="-6" r="16" /><circle cx="34" cy="0" r="13" /><rect x="0" y="0" width="34" height="13" />
  </g>
);
const Drops = ({ x, y, n = 4, color = C.rain, snow }) => (
  <g stroke={color} strokeWidth="2" strokeLinecap="round">{Array.from({ length: n }, (_, i) => (snow
    ? <text key={i} x={x + i * 9} y={y + (i % 2) * 8} fontSize="11" fill={C.snow} stroke="none">*</text>
    : <line key={i} x1={x + i * 9} y1={y + (i % 2) * 6} x2={x + i * 9 - 3} y2={y + 8 + (i % 2) * 6} />))}</g>
);
const UK = ({ x, y, s = 1 }) => (
  <path transform={`translate(${x} ${y}) scale(${s})`} fill={C.land} opacity="0.85"
    d="M20 0 L28 6 L26 18 L33 30 L30 44 L38 58 L44 76 L40 88 L30 92 L18 90 L22 80 L14 70 L18 58 L10 50 L14 38 L8 28 L14 18 L10 8 Z M-6 52 L4 48 L8 58 L2 66 L-8 62 Z" />
);

function Frame({ title, children, h = 220, caption }) {
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 520 ${h}`} role="img" aria-label={`Illustrative diagram: ${title}`} style={{ width: '100%', height: 'auto', display: 'block', background: 'var(--panel2)', borderRadius: 12, border: '1px solid var(--line)' }}>
        {children}
        <T x={510} y={h - 8} size={9} anchor="end" fill={C.ink2} weight={500}>Illustrative diagram — not a forecast or real data</T>
      </svg>
      {caption && <figcaption className="note" style={{ marginTop: 6 }}>{caption}</figcaption>}
    </figure>
  );
}

const DIAGRAMS = {
  'jet-position': () => (
    <Frame title="Jet stream positions" caption="Where the jet stream runs decides which areas get Atlantic lows. North of the UK: settled south. Over the UK: wet and windy. South: lows across southern Britain or France, cold air possibly to the north.">
      <UK x={240} y={60} s={1.2} />
      {[[40, C.jet, 'Jet to the north — settled, warm south'], [110, C.hot, 'Jet over the UK — wet & windy'], [175, C.cold, 'Jet to the south — cool, wet south; cold possible']].map(([y, c, l], i) => (
        <g key={i}>
          <path d={`M20 ${y} C120 ${y - 18} 220 ${y + 18} 330 ${y} S470 ${y - 14} 500 ${y}`} stroke={c} strokeWidth="4" fill="none" opacity="0.85" />
          <Arrow x1={470} y1={y - 5} x2={500} y2={y} color={c} />
          <T x={24} y={y - 10} anchor="start" size={10} fill={c}>{l}</T>
        </g>
      ))}
    </Frame>
  ),
  'omega-block': () => (
    <Frame title="Omega block" caption="A blocking high sits between two lows, shaped like Ω. Weather systems are diverted around it; the UK's weather depends on where it sits.">
      <path d="M20 170 C90 170 110 60 200 40 C290 20 330 60 340 100 C350 140 400 170 500 170" stroke={C.jet} strokeWidth="4" fill="none" />
      <T x={260} y={92} size={26} fill={C.warm} weight={800}>H</T>
      <T x={110} y={180} size={22} fill={C.cold} weight={800}>L</T>
      <T x={430} y={180} size={22} fill={C.cold} weight={800}>L</T>
      <UK x={235} y={100} s={0.8} />
      <T x={260} y={30} size={10}>Jet diverted around the block</T>
    </Frame>
  ),
  'frontal-low': () => (
    <Frame title="Atlantic depression and its fronts" caption="A mature low: rain spreads ahead of the warm front, mild air in the warm sector, a sharper band on the cold front, then showers in colder air behind.">
      <T x={180} y={110} size={26} fill={C.cold} weight={800}>L</T>
      <path d="M195 100 C250 95 300 105 350 130" stroke={C.hot} strokeWidth="3" fill="none" />
      {[0, 1, 2, 3].map((i) => <circle key={i} cx={225 + i * 35} cy={100 + i * 7} r="5" fill={C.hot} />)}
      <path d="M190 118 C200 150 220 180 250 205" stroke={C.cold} strokeWidth="3" fill="none" />
      {[0, 1, 2].map((i) => <path key={i} d={`M${197 + i * 15} ${135 + i * 22} l10 4 l-8 7z`} fill={C.cold} />)}
      <T x={350} y={160} size={10}>Warm sector (mild, damp)</T>
      <T x={360} y={110} size={10}>Warm front: steady rain</T>
      <T x={120} y={175} size={10}>Cold front: heavy band, wind veers</T>
      <T x={90} y={60} size={10}>Cold air: showers, squalls</T>
      <Arrow x1={300} y1={40} x2={360} y2={30} color={C.jet} /><T x={300} y={26} size={10} fill={C.jet}>Jet aloft</T>
    </Frame>
  ),
  inversion: () => (
    <Frame title="Temperature inversion" caption="Normally air cools with height. In an inversion a warm layer sits above cold air, trapping fog, low cloud and pollution beneath it.">
      <line x1="60" y1="190" x2="480" y2="190" stroke={C.line} /><line x1="60" y1="190" x2="60" y2="30" stroke={C.line} />
      <T x={40} y={30} size={10}>height</T><T x={470} y={205} size={10}>temperature →</T>
      <path d="M120 190 L210 120 L170 95 L110 40" stroke={C.warm} strokeWidth="3" fill="none" />
      <rect x="60" y="118" width="420" height="3" fill={C.warm} opacity="0.5" />
      <T x={300} y={114} size={11} fill={C.warm}>Inversion "lid": warmer air above</T>
      <rect x="62" y="150" width="416" height="38" fill={C.cloud} opacity="0.35" />
      <T x={300} y={174} size={11}>Fog, low cloud or smoke trapped below</T>
    </Frame>
  ),
  'air-masses': () => (
    <Frame title="UK air masses" h={250} caption="The UK's main air masses by source region. The track the air takes over sea or land modifies it before it arrives.">
      <UK x={235} y={80} s={1} />
      {[[250, 30, 'Arctic maritime (Am) — N', C.cold, 250, 75], [90, 70, 'Polar maritime (Pm) — NW/W', C.cool, 225, 110], [430, 70, 'Polar continental (Pc) — E', C.cold, 285, 120], [90, 200, 'Tropical maritime (Tm) — SW', C.warm, 225, 165], [430, 210, 'Tropical continental (Tc) — S/SE', C.hot, 280, 175], [430, 30, 'Arctic continental (Ac) — NE', C.cold, 280, 85]].map(([x, y, l, c, tx, ty], i) => (
        <g key={i}><T x={x} y={y} size={10} fill={c}>{l}</T><Arrow x1={x} y1={y + 6} x2={tx} y2={ty} color={c} /></g>
      ))}
    </Frame>
  ),
  'snow-profile': () => (
    <Frame title="Rain, sleet or snow?" caption="Snow falls where the air near the ground stays cold enough (roughly below 2 °C). The freezing level can sit on the hills, so tops are white while valleys get rain.">
      <path d="M20 190 L120 120 L190 150 L260 70 L330 140 L420 110 L500 190 Z" fill={C.land} opacity="0.8" />
      <line x1="20" y1="120" x2="500" y2="120" stroke={C.cold} strokeDasharray="6 5" strokeWidth="2" />
      <T x={470} y={114} size={10} fill={C.cold} anchor="end">freezing level (0 °C)</T>
      <Cloud x={200} y={30} s={1.3} /><Cloud x={330} y={40} s={1.1} />
      <Drops x={230} y={70} n={4} snow /><Drops x={360} y={85} n={3} />
      <T x={262} y={62} size={10}>snow on hills</T><T x={400} y={140} size={10}>rain or sleet lower down</T>
    </Frame>
  ),
  'snow-streamer': () => (
    <Frame title="Sea-effect snow showers" caption="Very cold air crossing a relatively warm sea picks up heat and moisture, building shower bands that drive inland where the wind blows them — often along convergence lines.">
      <rect x="20" y="40" width="240" height="150" fill={C.sea} opacity="0.55" rx="6" />
      <path d="M260 40 L500 40 L500 190 L260 190 Z" fill={C.land} opacity="0.8" />
      <T x={140} y={60} size={10}>relatively warm sea</T><T x={380} y={60} size={10}>coast and hills</T>
      {[90, 130, 165].map((y, i) => <Arrow key={i} x1={30} y1={y} x2={250} y2={y} color={C.cold} />)}
      <T x={60} y={82} anchor="start" size={10} fill={C.cold}>very cold onshore wind</T>
      {[0, 1, 2].map((i) => <Cloud key={i} x={170 + i * 70} y={110 + (i % 2) * 8} s={0.9} />)}
      {[0, 1, 2].map((i) => <Drops key={i} x={180 + i * 70} y={130} n={3} snow />)}
      <T x={390} y={175} size={10}>snow piles up where bands repeat</T>
    </Frame>
  ),
  'freezing-rain-profile': () => (
    <Frame title="Freezing rain profile" caption="Snow melts in a warm layer aloft, then falls as rain into a shallow sub-zero layer at the surface. The drops become supercooled and freeze on impact, glazing everything.">
      <rect x="60" y="30" width="420" height="50" fill={C.cold} opacity="0.2" /><T x={270} y={60} size={11}>Cold cloud: snow forms</T>
      <rect x="60" y="80" width="420" height="60" fill={C.warm} opacity="0.25" /><T x={270} y={115} size={11}>Warm layer above 0 °C: snow melts to rain</T>
      <rect x="60" y="140" width="420" height="40" fill={C.cold} opacity="0.3" /><T x={270} y={165} size={11}>Shallow sub-zero layer: drops supercool</T>
      <rect x="60" y="180" width="420" height="10" fill={C.cool} /><T x={270} y={204} size={10} fill={C.cool}>Glaze ice on every surface</T>
      <Drops x={100} y={40} n={3} snow /><Drops x={100} y={95} n={3} /><Drops x={100} y={150} n={3} color={C.cool} />
    </Frame>
  ),
  orographic: () => (
    <Frame title="Orographic rain and rain shadow" caption="Moist air forced up hills cools and wrings out heavy rain on the windward side; descending air on the lee side warms and dries.">
      <path d="M20 200 L160 200 L260 70 L340 200 L500 200 Z" fill={C.land} opacity="0.85" />
      <Arrow x1={30} y1={180} x2={150} y2={170} color={C.warm} /><Arrow x1={160} y1={160} x2={250} y2={70} color={C.warm} /><Arrow x1={270} y1={70} x2={360} y2={175} color={C.warm} />
      <Cloud x={175} y={60} s={1.3} /><Drops x={180} y={95} n={5} />
      <T x={70} y={160} size={10}>moist air</T><T x={160} y={40} size={10}>heavy windward rain</T><T x={420} y={160} size={10}>drier, warmer lee</T>
    </Frame>
  ),
  plume: () => (
    <Frame title="Spanish plume" caption="Very warm air from Iberia forms a lid aloft. When surface heating and cooler air arriving from the west break the lid, storms can erupt.">
      <rect x="40" y="70" width="440" height="40" fill={C.hot} opacity="0.25" /><T x={260} y={95} size={11} fill={C.hot}>warm, dry plume aloft acts as a lid</T>
      <rect x="40" y="110" width="440" height="80" fill={C.warm} opacity="0.12" /><T x={300} y={170} size={11}>hot, humid air building beneath</T>
      <Arrow x1={60} y1={60} x2={160} y2={60} color={C.cold} /><T x={110} y={50} size={10} fill={C.cold}>cooler air from the west</T>
      <Arrow x1={300} y1={190} x2={300} y2={120} color={C.warm} />
      <path d="M330 190 L330 40 L380 30 L420 40 L370 50 L360 190 Z" fill={C.cloud} opacity="0.85" /><T x={400} y={25} size={10}>storm breaks through</T>
    </Frame>
  ),
  'sea-breeze': () => (
    <Frame title="Sea breeze" caption="Land heats faster than the sea in sunshine, so cooler sea air flows inland during the afternoon. Where breezes meet, air rises and showers can form.">
      <rect x="20" y="150" width="200" height="45" fill={C.sea} opacity="0.6" /><rect x="220" y="150" width="280" height="45" fill={C.land} opacity="0.8" />
      <T x={110} y={178} size={10}>cool sea</T><T x={360} y={178} size={10}>warm land</T>
      <Arrow x1={120} y1={140} x2={300} y2={140} color={C.cool} /><Arrow x1={320} y1={130} x2={320} y2={70} color={C.warm} />
      <Arrow x1={300} y1={60} x2={130} y2={60} color={C.ink2} /><Arrow x1={110} y1={70} x2={110} y2={130} color={C.ink2} />
      <Cloud x={300} y={50} s={1} /><T x={420} y={60} size={10}>sea-breeze front</T>
    </Frame>
  ),
  convergence: () => (
    <Frame title="Convergence line" caption="Winds meeting from different directions force air upwards along a line, setting off showers or storms that can repeat over the same places.">
      <UK x={235} y={50} s={1.2} />
      <Arrow x1={120} y1={60} x2={250} y2={120} color={C.cool} /><Arrow x1={120} y1={200} x2={250} y2={130} color={C.cool} />
      <line x1="250" y1="60" x2="270" y2="200" stroke={C.warm} strokeWidth="3" strokeDasharray="6 4" />
      <T x={360} y={100} size={10}>air forced up along the line</T>
    </Frame>
  ),
  convection: () => (
    <Frame title="Convection and thunderstorms" caption="Thunderstorms need moisture, instability (warm air beneath much colder air) and a trigger to lift it. Organised storms also need wind shear.">
      <line x1="20" y1="195" x2="500" y2="195" stroke={C.line} />
      <path d="M180 195 L180 120 C170 80 200 50 240 45 C280 30 330 35 360 55 L420 50 L360 60 C350 90 320 120 300 195 Z" fill={C.cloud} opacity="0.85" />
      <Arrow x1={230} y1={190} x2={230} y2={70} color={C.warm} /><T x={140} y={150} size={10} fill={C.warm}>warm, moist updraught</T>
      <Arrow x1={300} y1={80} x2={300} y2={190} color={C.cold} /><T x={390} y={150} size={10} fill={C.cold}>cold downdraught & rain</T>
      <T x={400} y={40} size={10}>anvil</T>
    </Frame>
  ),
  supercell: () => (
    <Frame title="Supercell" caption="In strong wind shear, horizontal spin in the lower atmosphere is tilted upright by the updraught, giving a persistent rotating updraught (mesocyclone). Supercells need shear as well as instability.">
      <path d="M140 195 L150 110 C140 70 190 40 250 40 C320 30 380 40 470 50 L380 70 C350 100 330 140 320 195 Z" fill={C.cloud} opacity="0.85" />
      <ellipse cx="230" cy="130" rx="40" ry="14" stroke={C.jet} strokeWidth="3" fill="none" /><Arrow x1={260} y1={120} x2={268} y2={132} color={C.jet} />
      <T x={230} y={162} size={10} fill={C.jet}>rotating updraught</T>
      {[60, 90, 120].map((y, i) => <Arrow key={i} x1={20} y1={y + 60} x2={20 + 60 + i * 30} y2={y + 60} color={C.ink2} />)}
      <T x={60} y={110} size={10} anchor="start">wind increasing with height (shear)</T>
    </Frame>
  ),
  'storm-surge': () => (
    <Frame title="Storm surge" caption="Strong winds pile water against the coast and low pressure lets the sea rise about 1 cm per millibar. If this coincides with high tide, the sea can overtop defences.">
      <path d="M20 150 Q140 120 280 110 L380 105 L380 200 L20 200 Z" fill={C.sea} opacity="0.65" />
      <line x1="20" y1="150" x2="380" y2="150" stroke={C.cool} strokeDasharray="5 4" /><T x={90} y={165} size={10}>normal high tide</T>
      <path d="M380 105 L420 100 L500 100 L500 200 L380 200 Z" fill={C.land} opacity="0.85" /><rect x="374" y="115" width="10" height="85" fill={C.ink2} />
      <Arrow x1={60} y1={80} x2={330} y2={80} color={C.ink2} /><T x={190} y={70} size={10}>onshore gale piles water up</T>
      <T x={300} y={128} size={10}>surge</T>
    </Frame>
  ),
  'lee-wave': () => (
    <Frame title="Mountain (lee) waves" caption="Stable air flowing over a ridge sets up standing waves downwind. Lens-shaped clouds can sit at the wave crests, and strong gusts can reach the lee slopes.">
      <path d="M20 200 L120 200 L190 100 L260 200 L500 200 Z" fill={C.land} opacity="0.85" />
      <path d="M20 90 L180 85 C230 80 240 140 290 110 S360 70 400 100 S470 120 500 100" stroke={C.cool} strokeWidth="3" fill="none" />
      <ellipse cx="335" cy="78" rx="34" ry="9" fill={C.cloud} /><ellipse cx="455" cy="92" rx="28" ry="8" fill={C.cloud} />
      <T x={335} y={60} size={10}>lenticular cloud</T><T x={250} y={185} size={10}>gusty lee-slope winds</T>
    </Frame>
  ),
  foehn: () => (
    <Frame title="Föhn effect" caption="Air rising over mountains cools and drops rain; descending on the lee side it warms by compression, arriving warmer and drier than it started.">
      <path d="M20 200 L170 200 L260 60 L350 200 L500 200 Z" fill={C.land} opacity="0.85" />
      <Arrow x1={40} y1={185} x2={230} y2={70} color={C.cool} /><Arrow x1={290} y1={70} x2={480} y2={185} color={C.hot} />
      <Cloud x={175} y={55} s={1.2} /><Drops x={180} y={90} n={4} />
      <T x={70} y={150} size={10} fill={C.cool}>cool, moist</T><T x={440} y={150} size={10} fill={C.hot}>warm, dry</T>
    </Frame>
  ),
};

export default function Diagram({ id }) {
  const D = DIAGRAMS[id];
  return D ? <D /> : null;
}
export const DIAGRAM_IDS = Object.keys(DIAGRAMS);
