/* ════════════════════════════════════════════════════════════════════════════
   WeatherScene — a layered sky, drawn rather than tinted.

   The backgrounds used to be a flat CSS gradient with particles falling over
   it. That is fine for rain, which IS particles, but it meant a sunny sky had
   no sun in it, a cloudy sky had no cloud, and a thunderstorm was a white
   rectangle fading in and out. This puts the actual subject in the picture:

     glow     the band of lit air that sits on every horizon
     land     two ridges, near and far, so the sky has something to end against
     sun      disc + atmospheric bloom + slow god rays
     moon     lit limb, craters, halo ring
     stars    depth-sorted field, a galactic band on the clearest nights
     cloud    layered banks at two depths, drifting at different speeds
     shafts   falling curtains under the cloud base, where it is raining
     bolt     branched, struck in bursts, lighting the sky it sits in
     fog      sheared bands moving at different rates

   THE SCENE IS DERIVED FROM THE NAME, not hand-written 66 times. "Heavy Rain
   Night" parses to moon + near-total cloud + heavy tone; "Sunny Intervals" to
   sun + light scattered cloud. One rule set covers every entry and a new
   weather type gets a sensible scene for free — 66 hand-maintained scene specs
   would drift out of step with the gradients within a week.

   THE BODIES ARE DIVS SIZED IN cqmin, NOT SVG SIZED IN PERCENT. These scenes
   render at wildly different shapes: a 196x208 city card on the home page and
   a full-bleed banner on the forecast page. The body layers use
   preserveAspectRatio="none", which stretched the sun into a long ellipse on
   anything that was not square. Container-query units measure the short side
   of whatever box the scene lands in, so the disc is round in both.

   CLOUDS ARE BLURRED ELLIPSE CLUSTERS, NOT feTurbulence. Fractal noise makes a
   more convincing cloud, but this library renders 66 tiles at once and a
   turbulence filter per tile is a per-frame raster of the whole element. Soft
   overlapping ellipses stay on the compositor, and at these sizes the
   difference is small. Turbulence is reserved for fog, where the shape really
   does need to be irregular and only a handful of tiles use it.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useMemo, useId } from 'react';
import './weatherScene.css';

/* ── Deterministic variation ─────────────────────────────────────────────── */

/**
 * A stable hash of the condition name, and a stream of numbers from it.
 *
 * EVERY SKY USED THE SAME FIVE CLOUD PUFFS IN THE SAME FIVE PLACES, so a grid
 * of fifteen cities came out as fifteen copies of one picture — which is most
 * of why the backgrounds read as "a dark blue rectangle" rather than as
 * weather. Seeding the cloud layout, the skyline and the star field off the
 * name gives every condition its own silhouette, while staying completely
 * deterministic: the same weather draws the same sky on every render, every
 * reload, and in the dashboard library as on the live page.
 */
function seedOf(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/* Lehmer / MINSTD. Plain multiplication, NOT Math.imul: imul is a signed
   32-bit multiply, so s * 48271 wraps past 2^31 and comes back negative, and a
   generator that returns negative numbers hands negative radii to <circle> and
   negative sizes to everything downstream. s < 2^31 and 48271 < 2^16, so the
   product is under 2^47 and a double holds it exactly — no wrap, no loss. */
function rng(seed) {
  let s = (Math.floor(Math.abs(seed) * 2147483646) % 2147483646) + 1;
  return () => {
    s = (s * 48271) % 2147483647;
    return s / 2147483647;
  };
}

/* ── Reading a scene out of the weather name ─────────────────────────────── */

/* How much sky each base condition covers, 0 clear .. 1 solid overcast. */
const COVERAGE = [
  [/^Sunny$|^Clear/, 0],
  [/Sunny Intervals/, 0.28],
  [/Partly Cloudy/, 0.5],
  [/^Cloudy/, 0.82],
  [/^Overcast/, 1],
  [/Mist|Fog/, 0.7],
  [/Windy/, 0.35],
  [/Drizzle/, 0.85],
  [/Torrential|Blizzard/, 1],
  [/Heavy/, 0.95],
  [/Thunder/, 0.95],
  [/Moderate/, 0.9],
  [/Shower|Flurry/, 0.66],
  [/Light|Sleet|Hail|Snow|Rain/, 0.85],
];

/** Darkness of the cloud base, driven by how much water it is carrying. */
function cloudTone(name, night) {
  if (/Torrential|Blizzard|Thunder/.test(name)) return night ? ['#1d232e', '#0d1117'] : ['#4a5361', '#2c333e'];
  if (/Heavy/.test(name)) return night ? ['#232a36', '#12171f'] : ['#5c6673', '#3a424e'];
  if (/Moderate|Overcast|Drizzle/.test(name)) return night ? ['#2a323f', '#171d26'] : ['#78828f', '#525b68'];
  if (/Snow|Sleet|Hail|Flurry/.test(name)) return night ? ['#333c4a', '#1d2430'] : ['#aeb8c6', '#8892a1'];
  if (/Rain|Shower/.test(name)) return night ? ['#2e3745', '#1a2029'] : ['#8d97a5', '#646e7c'];
  return night ? ['#39435270', '#232a3570'] : ['#ffffff', '#cfd9e6'];
}

/**
 * Turn a config name into a scene.
 *
 * `Night` and `Cloud` suffixes are the two modifiers the library uses: Night
 * swaps the sun for a moon and darkens everything, Cloud means the sky body is
 * hidden behind unbroken cloud (a continuous spell rather than a showery one).
 */
export function sceneFor(name, phase = 'day') {
  const isNightName = / Night$/.test(name);
  const isCloudOnly = / Cloud$/.test(name);
  const base = name.replace(/ (Night|Cloud)$/, '');
  const night = isNightName || phase === 'night';
  const dusk = phase === 'sunrise' || phase === 'sunset';

  let coverage = 0.6;
  for (const [re, v] of COVERAGE) if (re.test(base)) { coverage = v; break; }

  /* SHOWERY WEATHER HAS BREAKS IN IT, and the break is the whole point: the sun
     or moon showing through is what separates a shower from continuous rain,
     on the backgrounds exactly as on the icons. Intensity is matched first
     ("Thundery Shower" hits /Thunder/ at 0.95), so without this a heavy shower
     came out as solid overcast and lost its sky body — the one element that
     told you it was showery. */
  if (/Shower|Flurry|Intervals/.test(base)) coverage = Math.min(coverage, 0.72);

  /* The Cloud suffix means the opposite: unbroken cloud, no break, so the body
     is deliberately buried. */
  if (isCloudOnly) coverage = Math.max(coverage, 0.92);

  /* What is falling, and how hard. The particle canvas above this draws the
     individual drops; the scene draws the curtain they fall in, which is what
     you actually see of rain at a distance and the one thing the canvas cannot
     give you — thirty separate drops never read as a downpour. */
  const precip = /Snow|Blizzard|Flurry/.test(base) ? 'snow'
    : /Sleet|Hail/.test(base) ? 'sleet'
      : /Drizzle|Rain|Shower/.test(base) ? 'rain'
        : null;
  const intensity = /Torrential|Blizzard/.test(base) ? 1
    : /Heavy/.test(base) ? 0.82
      : /Moderate/.test(base) ? 0.56
        : /Light|Drizzle|Flurry/.test(base) ? 0.3
          : 0.48;

  return {
    night, dusk, coverage, precip, intensity,
    seed: seedOf(name),
    body: isCloudOnly || coverage > 0.93 ? null : (night ? 'moon' : 'sun'),
    tone: cloudTone(base, night),
    lightning: /Thunder/.test(base),
    fog: /Mist|Fog/.test(base),
    wind: /Windy|Blizzard/.test(base),
    stars: night ? (coverage > 0.8 ? 0 : Math.round(90 * (1 - coverage))) : 0,
  };
}

/* ── Atmosphere ──────────────────────────────────────────────────────────── */

/**
 * The band of lit air along the horizon.
 *
 * Air is not evenly lit: light piles up near the ground and the zenith is
 * always darker, and a plain top-to-bottom gradient has none of that. This ran
 * before at a third of its current strength, behind a 14px blur, and was —
 * correctly — invisible. On an overcast night it is most of what stops the
 * scene being a flat black rectangle, so it has to be strong enough to see.
 */
function SkyGlow({ night, dusk }) {
  const c = dusk ? [255, 146, 64] : night ? [96, 156, 224] : [255, 241, 208];
  /* Hugging the horizon, not washing the frame. The first pass ran dusk at
     0.62 over 58% of the height, which is fine on a 200px card and a solid
     orange smear behind a full-page background — and the Location Weather
     panels are glass, so it came through them and tinted the whole page.
     Dusk stays the strongest of the three, because a real one is, but it now
     falls off inside the bottom third. */
  const a = dusk ? 0.4 : night ? 0.3 : 0.34;
  const rgb = (o) => `rgba(${c[0]},${c[1]},${c[2]},${o})`;
  return (
    <div
      className="ws-layer"
      aria-hidden="true"
      style={{
        background: `radial-gradient(118% 42% at 50% 100%, ${rgb(a)} 0%, ${rgb(a * 0.3)} 36%, ${rgb(0)} 72%)`,
      }} />
  );
}

/**
 * A skyline, in two ridges.
 *
 * THE SINGLE BIGGEST THING THAT WAS MISSING. A gradient with a small sun in it
 * is a colour swatch; the same gradient with land along the bottom is a view
 * out of a window — and at card size a silhouette survives where a corona or a
 * cloud underside does not. The far ridge is tinted toward the horizon glow so
 * the air between the two reads as distance; the near one is close to black,
 * which also buys the temperature sitting over it a good deal of contrast.
 */
function Landform({ seed, night, dusk }) {
  const path = useMemo(() => {
    const rand = rng(seed);
    const ridge = (baseY, amp) => {
      const p = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
      const f = [1.1 + rand() * 1.0, 2.5 + rand() * 1.6, 4.8 + rand() * 3.0];
      const pts = [];
      for (let x = 0; x <= 100; x += 2.5) {
        const t = (x / 100) * Math.PI * 2;
        const y = baseY
          - Math.sin(t * f[0] + p[0]) * amp
          - Math.sin(t * f[1] + p[1]) * amp * 0.42
          - Math.sin(t * f[2] + p[2]) * amp * 0.17;
        pts.push(`${x},${y.toFixed(2)}`);
      }
      return `M-3,104 L-3,${baseY} L${pts.join(' L')} L103,${baseY} L103,104 Z`;
    };
    /* The crest sits at 70%, not 85%. The city cards lay a bottom-weighted
       scrim over the scene so the temperature has something solid to sit on,
       and at 85% the whole skyline was under 80% black — drawn, measurable in
       the DOM, and completely invisible. Above the scrim's knee it reads. */
    return { far: ridge(70, 6.5), near: ridge(81, 4.5) };
  }, [seed]);

  const far = dusk ? '#5b3a52' : night ? '#121d33' : '#6d8296';
  const near = dusk ? '#241426' : night ? '#060a14' : '#2f3f4e';

  return (
    <svg className="ws-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path d={path.far} fill={far} opacity={night ? 0.85 : 0.6} />
      <path d={path.near} fill={near} opacity={night ? 0.96 : 0.9} />
    </svg>
  );
}

/* ── Sky bodies ──────────────────────────────────────────────────────────── */

/* Drawn as positioned divs rather than SVG, so they stay perfectly round in a
   card and in a wide banner alike — see the header note on cqmin. */

function Sun({ dusk }) {
  // Low and warm at dawn/dusk, high and white-hot at midday — the single
  // strongest cue for time of day, and cheaper than restyling the whole sky.
  const left = dusk ? 26 : 73;
  const top = dusk ? 68 : 24;
  const core = dusk ? '#FFD9A0' : '#FFF8D8';
  const mid = dusk ? '#FF9A3C' : '#FFD54A';
  const glow = dusk ? '#FF6A2A' : '#FFC13B';
  return (
    <div className="ws-body" style={{ left: `${left}%`, top: `${top}%` }} aria-hidden="true">
      {/* God rays: long soft spokes, turning almost imperceptibly. */}
      <div className="ws-rays" style={{ opacity: dusk ? 0.45 : 0.3, color: glow }} />
      {/* Weaker bloom at dusk, not stronger: the sky behind it is already
          orange, so the same halo that reads as glare at noon reads as a
          smear at sunset. */}
      <div
        className="ws-bloom ws-halo"
        style={{ background: `radial-gradient(circle, ${glow}${dusk ? '70' : 'A6'} 0%, ${glow}${dusk ? '26' : '38'} 42%, ${glow}00 70%)` }} />
      <div
        className="ws-disc"
        style={{ background: `radial-gradient(circle at 34% 30%, ${core} 0%, ${mid} 55%, ${glow} 100%)` }} />
    </div>
  );
}

function Moon() {
  return (
    <div className="ws-body" style={{ left: '73%', top: '22%' }} aria-hidden="true">
      <div
        className="ws-bloom ws-halo"
        style={{ background: 'radial-gradient(circle, rgba(200,224,255,0.46) 0%, rgba(170,205,255,0.14) 40%, rgba(150,190,255,0) 68%)' }} />
      {/* A thin ring at the edge of the halo. Moonlit haze really does make
          one, and it is the detail that stops the moon reading as a grey
          sticker dropped on the sky. */}
      <div className="ws-ring" />
      <div className="ws-disc ws-moon">
        <span className="ws-crater" style={{ left: '20%', top: '24%', width: '24%' }} />
        <span className="ws-crater" style={{ left: '56%', top: '52%', width: '16%' }} />
        <span className="ws-crater" style={{ left: '33%', top: '62%', width: '12%' }} />
      </div>
    </div>
  );
}

function Stars({ count, seed }) {
  // Deterministic scatter: a random field would reshuffle on every re-render
  // and the sky would visibly twitch.
  const stars = useMemo(() => {
    const rand = rng(seed + 0.37);
    return Array.from({ length: count }, (_, i) => ({
      x: (rand() * 100).toFixed(1),
      y: (rand() * 76).toFixed(1),
      // A handful of bright ones carry the field and the rest are dust. An
      // even spread of identical dots reads as noise, not as a sky.
      r: (rand() < 0.14 ? 0.7 + rand() * 0.6 : 0.2 + rand() * 0.34).toFixed(2),
      o: (0.45 + rand() * 0.55).toFixed(2),
      d: ((i * 0.41) % 4).toFixed(2),
    }));
  }, [count, seed]);
  if (!count) return null;
  return (
    <svg className="ws-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {stars.map((s, i) => (
        <circle
          key={i} className="ws-star" cx={s.x} cy={s.y} r={s.r} fill="#EAF2FF"
          opacity={s.o} style={{ animationDelay: `${s.d}s` }} />
      ))}
    </svg>
  );
}

/**
 * The bright patch where the sun is, seen through unbroken cloud.
 *
 * Overcast had no sky body by design — you cannot see the sun through it — and
 * the result was a dead rectangle, the flattest scene in the whole set. But
 * real overcast is not evenly lit: there is always a patch you could point at
 * and say the sun is behind that. This is that patch, and it is the difference
 * between a grey sky and a grey card.
 */
function Glare({ night, dusk }) {
  const c = dusk ? [255, 172, 112] : night ? [166, 198, 240] : [255, 250, 236];
  const rgb = (o) => `rgba(${c[0]},${c[1]},${c[2]},${o})`;
  const x = dusk ? 28 : 70;
  return (
    <div
      className="ws-layer"
      aria-hidden="true"
      style={{
        background: `radial-gradient(42% 32% at ${x}% 20%, ${rgb(night ? 0.16 : 0.3)} 0%, ${rgb(night ? 0.05 : 0.1)} 46%, ${rgb(0)} 76%)`,
      }} />
  );
}

/** The galactic band, on nights clear enough to have earned it. */
function MilkyWay() {
  return (
    <div
      className="ws-layer"
      aria-hidden="true"
      style={{
        background: 'linear-gradient(104deg, rgba(190,214,255,0) 36%, rgba(196,214,255,0.13) 47%, rgba(226,232,255,0.20) 51%, rgba(196,214,255,0.12) 55%, rgba(190,214,255,0) 66%)',
      }} />
  );
}

/* ── Cloud ───────────────────────────────────────────────────────────────── */

/**
 * One bank of cloud: overlapping soft ellipses sharing a vertical gradient, so
 * the underside is heavy and the top catches light. The puffs are seeded, so
 * overcast in Paris is not pixel-for-pixel overcast in Berlin.
 */
function CloudBank({ tone, y, scale, opacity, blur, drift, seed }) {
  const id = useId();
  const [top, bottom] = tone;
  const puffs = useMemo(() => {
    const rand = rng(seed);
    return Array.from({ length: 6 }, (_, i) => {
      const cx = 8 + i * 17 + (rand() - 0.5) * 9;
      return [cx, 1 + rand() * 6, 11 + rand() * 7, 6 + rand() * 4];
    });
  }, [seed]);
  return (
    <svg
      className={`ws-layer ${drift}`} viewBox="0 0 100 40" preserveAspectRatio="none"
      aria-hidden="true"
      style={{ top: `${y}%`, height: `${44 * scale}%`, filter: `blur(${blur}px)`, opacity }}>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={top} />
          <stop offset="100%" stopColor={bottom} />
        </linearGradient>
      </defs>
      <g fill={`url(#${id}g)`}>
        {puffs.map(([cx, cy, rx, ry], i) => <ellipse key={i} cx={cx} cy={cy + 18} rx={rx} ry={ry} />)}
        <rect x="4" y="18" width="92" height="16" rx="8" />
      </g>
    </svg>
  );
}

function Clouds({ coverage, tone, seed }) {
  if (coverage <= 0.02) return null;
  const layers = [];
  // Far bank first, thinner and higher, so the near one reads as closer.
  if (coverage > 0.2) {
    layers.push(<CloudBank key="far" tone={tone} y={-16} scale={0.8} seed={seed + 0.11}
                           opacity={Math.min(0.75, coverage * 0.8)} blur={3} drift="ws-far" />);
  }
  layers.push(<CloudBank key="near" tone={tone} y={coverage > 0.85 ? -22 : -6} scale={1} seed={seed + 0.73}
                         opacity={Math.min(1, 0.35 + coverage * 0.75)} blur={1.6} drift="ws-near" />);
  // At full cover the banks alone still leave gaps; a wash closes the sky —
  // but it now stops above the horizon, or it would bury the land as well.
  if (coverage > 0.9) {
    layers.push(
      <div key="wash" className="ws-layer"
           style={{ background: `linear-gradient(180deg, ${tone[0]} 0%, ${tone[1]} 56%, transparent 80%)`,
                    opacity: (coverage - 0.9) * 6 }} />
    );
  }
  return <>{layers}</>;
}

/* ── Falling curtains ────────────────────────────────────────────────────── */

/**
 * The sheet of precipitation between the cloud base and the ground.
 *
 * The particle canvas over this draws individual drops, which is right up
 * close and useless at distance: thirty drops on a 196px card read as specks
 * on glass, not as a downpour. What you actually see of rain across a valley
 * is a curtain — a soft, slanted, moving veil — and that is the part that
 * makes heavy rain look different from mere cloud.
 *
 * The marks tile a 50-unit band, drawn three times from -50 to +50 and slid
 * down by exactly one band. Three copies rather than two because the visible
 * 0..100 window has to stay covered at both ends of the slide, and the extra
 * one means the loop restarts on an identical frame — no seam.
 */
function Shafts({ kind, intensity, night, seed }) {
  const marks = useMemo(() => {
    const rand = rng(seed + 0.53);
    const n = Math.round(10 + intensity * 30);
    return Array.from({ length: n }, () => ({
      x: rand() * 108 - 4,
      y: rand() * 50,
      len: kind === 'snow' ? 1.4 : 7 + rand() * 13 * intensity,
      w: kind === 'snow' ? 1.3 + rand() * 0.9 : 0.5 + rand() * 0.8,
      o: 0.16 + rand() * 0.3,
    }));
  }, [kind, intensity, seed]);

  const colour = kind === 'snow' ? '#EDF4FF' : kind === 'sleet' ? '#D6E6F7' : '#AFD4F5';
  // Rain leans; snow falls almost straight down and much more slowly.
  const lean = kind === 'snow' ? 2 : 9;
  const speed = kind === 'snow' ? 9 : 2.6 - intensity * 1.4;

  return (
    <svg
      className="ws-layer" viewBox="0 0 100 100" preserveAspectRatio="none"
      aria-hidden="true"
      style={{ opacity: night ? 0.5 : 0.7 }}>
      <g className="ws-shaft-run" style={{ animationDuration: `${speed}s` }}>
        {[-50, 0, 50].map((off) => (
          <g key={off} transform={`translate(0 ${off})`}>
            {marks.map((m, i) => (
              kind === 'snow'
                ? <circle key={i} cx={m.x} cy={m.y} r={m.w / 2} fill={colour} opacity={m.o} />
                : <line
                    key={i} x1={m.x} y1={m.y} x2={m.x - lean * (m.len / 16)} y2={m.y + m.len}
                    stroke={colour} strokeWidth={m.w} strokeLinecap="round" opacity={m.o} />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}

/* ── Lightning ───────────────────────────────────────────────────────────── */

function Lightning() {
  return (
    <>
      <div className="ws-layer ws-flash" style={{ background: 'radial-gradient(ellipse at 30% 20%, rgba(226,240,255,0.95), rgba(180,210,255,0.25) 45%, transparent 70%)' }} />
      <div className="ws-layer ws-flash-b" style={{ background: 'radial-gradient(ellipse at 72% 15%, rgba(226,240,255,0.9), rgba(180,210,255,0.2) 45%, transparent 70%)' }} />
      <svg className="ws-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <g className="ws-bolt" stroke="#F2F8FF" strokeWidth="1.1" fill="none"
           strokeLinecap="round" strokeLinejoin="round"
           style={{ filter: 'drop-shadow(0 0 3px rgba(190,220,255,0.95))' }}>
          <path d="M31,22 L26,48 L33,46 L27,74" />
          <path d="M28,40 L21,52" strokeWidth="0.7" />
          <path d="M31,58 L38,66" strokeWidth="0.6" />
        </g>
        <g className="ws-bolt-b" stroke="#F2F8FF" strokeWidth="0.9" fill="none"
           strokeLinecap="round" strokeLinejoin="round"
           style={{ filter: 'drop-shadow(0 0 3px rgba(190,220,255,0.9))' }}>
          <path d="M71,26 L67,50 L73,48 L69,70" />
          <path d="M69,42 L63,53" strokeWidth="0.6" />
        </g>
      </svg>
    </>
  );
}

/* ── Fog and wind ────────────────────────────────────────────────────────── */

function Fog({ night }) {
  const id = useId();
  const c = night ? 'rgba(150,166,186,' : 'rgba(232,240,248,';
  return (
    <svg className="ws-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        {/* The one place turbulence earns its cost: fog has to be irregular or
            it reads as painted stripes. */}
        <filter id={`${id}f`} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.014 0.05" numOctaves="3" seed="7" />
          <feDisplacementMap in="SourceGraphic" scale="14" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <g filter={`url(#${id}f)`}>
        <rect className="ws-fog-a" x="-20" y="46" width="140" height="15" rx="7" fill={`${c}0.5)`} />
        <rect className="ws-fog-b" x="-20" y="62" width="140" height="18" rx="9" fill={`${c}0.42)`} />
        <rect className="ws-fog-a" x="-20" y="78" width="140" height="20" rx="10" fill={`${c}0.35)`} />
      </g>
    </svg>
  );
}

function Wind() {
  const lines = [[22, 0], [38, 1.1], [54, 2.2], [70, 0.6], [86, 1.7]];
  return (
    <svg className="ws-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {lines.map(([y, d], i) => (
        <rect key={i} className="ws-gust" x="0" y={y} width="34" height="0.9" rx="0.45"
              fill="rgba(255,255,255,0.6)" style={{ animationDelay: `${d}s` }} />
      ))}
    </svg>
  );
}

/* ── Composition ─────────────────────────────────────────────────────────── */

/**
 * The full scene for one weather name, drawn over `gradient`.
 * Particles (rain, snow, hail) stay on the caller's canvas above this.
 *
 * Order is depth order, back to front: the glow is the far air, then the sky
 * body, then the land it sits behind, then the weather happening in front of
 * the land, then the vignette that ties the frame together and buys the text
 * over it some contrast.
 */
export default function WeatherScene({ name, gradient, phase = 'day', children }) {
  const s = useMemo(() => sceneFor(name, phase), [name, phase]);
  return (
    <div className="ws-root" style={{ background: gradient }}>
      <SkyGlow night={s.night} dusk={s.dusk} />
      {s.stars > 44 && <MilkyWay />}
      <Stars count={s.stars} seed={s.seed} />
      {s.body === 'sun' && <Sun dusk={s.dusk} />}
      {s.body === 'moon' && <Moon />}
      <Landform seed={s.seed} night={s.night} dusk={s.dusk} />
      <Clouds coverage={s.coverage} tone={s.tone} seed={s.seed} />
      {!s.body && <Glare night={s.night} dusk={s.dusk} />}
      {s.precip && <Shafts kind={s.precip} intensity={s.intensity} night={s.night} seed={s.seed} />}
      {s.fog && <Fog night={s.night} />}
      {s.wind && <Wind />}
      {s.lightning && <Lightning />}
      <div className="ws-vignette" aria-hidden="true" />
      {children}
    </div>
  );
}
