/* The live sky behind the Location page.

   A gradient for the weather and the sun's height (day, dawn, dusk, night), cross-faded when it
   changes, and one canvas on top for what moves: clouds drifting with the wind in two layers,
   stars, the sun's glow or the moon, rain slanting with the wind, snow, hail, fog banks, gusts,
   blown leaves and lightning. Everything comes from the hour being shown, so scrubbing through
   the forecast changes the sky.

   Nothing jumps. Every quantity (how hard it rains, snows or hails, the wind and the slant it
   gives the rain, the cloud cover and its shade, fog, stars, the sun's glow) glides to its new
   value over a second or two, drawn from particle pools made once for the window's size: heavier
   rain is more of the same drops, faster and longer, not a new set. The cloud shade cross-fades.

   Each weather has its own sky: a blizzard is a whiteout with snow driven sideways, torrential
   rain hangs sheets and spray, freezing rain is icy, a hot day shimmers, and a windy one races
   its clouds and blows leaves and gust streaks across. Wind changes every other sky too: the
   stronger it is, the more the rain slants and surges and the faster the clouds and snow go.

   Built to stay smooth: one canvas, sprites made once per tone (and shared by every sky on the
   page), each layer of streaks in a single path, the pixel ratio capped, nothing drawn while the
   tab is hidden, and a still picture for readers who ask their system for reduced motion.

   `contained` puts the sky inside its parent instead of behind the whole window (the home page's
   city cards): sized to the card, with clouds, drops and flakes scaled to it, drawn at about 30
   frames a second, and paused while the card is off screen.

   CardRain (below) is the rain landing on the page's top row of glass cards; WindowRain is the
   rain on the cards themselves, as on a window. */
import React, { useEffect, useMemo, useRef, useState } from 'react';

const SKIES = {
  clear:    { day: ['#1C66C9', '#79BBF0'], dawn: ['#3B5994', '#F2A67C'], dusk: ['#2B3A70', '#EE8A5B'], night: ['#050B1E', '#1A2C55'] },
  partly:   { day: ['#2C68B2', '#91BADF'], dawn: ['#455C8B', '#E5A784'], dusk: ['#34426D', '#DB916F'], night: ['#0A1327', '#24334E'] },
  cloudy:   { day: ['#5B6F84', '#A0AFBF'], dawn: ['#5A6780', '#BFA599'], dusk: ['#48536A', '#B28E82'], night: ['#141B26', '#2D3745'] },
  rain:     { day: ['#435468', '#7C8C9C'], dawn: ['#445064', '#8B8490'], dusk: ['#3B4457', '#827880'], night: ['#0F151E', '#252F3E'] },
  torrent:  { day: ['#2C3846', '#56636F'], dawn: ['#2F3644', '#615B63'], dusk: ['#29303D', '#58525B'], night: ['#090D14', '#1B222C'] },
  freezing: { day: ['#4C6884', '#AFC4D8'], dawn: ['#52607F', '#C4B4B6'], dusk: ['#465374', '#B5A1A4'], night: ['#101A28', '#2E3C52'] },
  storm:    { day: ['#26303D', '#535D69'], dawn: ['#282E3B', '#5B545E'], dusk: ['#222834', '#534E58'], night: ['#080B11', '#1C222B'] },
  snow:     { day: ['#788BA0', '#CAD4DF'], dawn: ['#77839E', '#D5C1BB'], dusk: ['#68738E', '#C2A9A6'], night: ['#1D2632', '#445063'] },
  blizzard: { day: ['#8E9BAB', '#E3E8EE'], dawn: ['#8C94A7', '#DCCEC9'], dusk: ['#7C8498', '#CBB7B3'], night: ['#29323F', '#59636F'] },
  fog:      { day: ['#8B97A4', '#C7CED6'], dawn: ['#8A91A0', '#CFBBB0'], dusk: ['#78808F', '#BCA59B'], night: ['#252B34', '#454D58'] },
  windy:    { day: ['#356FB6', '#A2C6E4'], dawn: ['#4A5D8D', '#E3AA8C'], dusk: ['#37457A', '#DA9171'], night: ['#0A1428', '#28395A'] },
  hot:      { day: ['#1258B8', '#EBC48C'], dawn: ['#4A5A90', '#F7A86E'], dusk: ['#3A3A72', '#F08A52'], night: ['#0B1330', '#3B2E48'] },
};

export function skyGroup(cond) {
  if (cond === 'thunder' || cond === 'thunderShowers') return 'storm';
  if (cond === 'blizzard') return 'blizzard';
  if (cond === 'torrentialRain') return 'torrent';
  if (cond === 'freezingRain') return 'freezing';
  if (cond === 'windy') return 'windy';
  if (cond === 'hot') return 'hot';
  if (['snow', 'heavySnow', 'snowShowers', 'sleet', 'hail'].includes(cond)) return 'snow';
  if (['rain', 'heavyRain', 'showers', 'heavyShowers', 'lightRain', 'drizzle'].includes(cond)) return 'rain';
  if (cond === 'fog' || cond === 'mist') return 'fog';
  if (cond === 'cloudy' || cond === 'overcast') return 'cloudy';
  if (cond === 'partly' || cond === 'mostlyClear' || cond === 'mostlyCloudy') return 'partly';
  return 'clear';
}
export function skyPhase(sun, morning) {
  if (sun < -6) return 'night';
  if (sun < 7) return morning ? 'dawn' : 'dusk';
  return 'day';
}
/** how dark the sky is, 0 bright … 1 black (the page tints its glass with it) */
export function skyDarkness(cond, sun) {
  const g = skyGroup(cond);
  const base = { clear: 0.15, partly: 0.2, cloudy: 0.35, rain: 0.45, torrent: 0.62, freezing: 0.38, storm: 0.65, snow: 0.25, blizzard: 0.22, fog: 0.3, windy: 0.2, hot: 0.12 }[g];
  return sun < -6 ? Math.max(base, 0.7) : sun < 7 ? Math.max(base, 0.45) : base;
}

/* what the weather puts in the sky, before smoothing: amounts 0…1 (rain can go a little over 1
   for torrential), the wind 0…1 with its slant, cloud cover and shade */
const RAINY = { drizzle: 0.25, lightRain: 0.5, rain: 2, heavyRain: 6, showers: 1.5, heavyShowers: 6, torrentialRain: 22, freezingRain: 1.5, thunder: 6, thunderShowers: 4, sleet: 1, hail: 3 };
const SNOWY = { snowShowers: 0.4, snow: 0.6, sleet: 0.35, heavySnow: 0.9, blizzard: 1 };
const BRIGHT = new Set(['clear', 'partly', 'hot', 'windy']);
function targetsOf(p) {
  const rate = p.rate > 0.05 ? p.rate : RAINY[p.cond] ?? 0;
  const raining = p.cond in RAINY;
  const towards = Math.sin(((p.wdir ?? 240) + 180) * (Math.PI / 180)) >= 0 ? 1 : -1;
  let wind = Math.min(1, (p.wind ?? 0) / 50);
  if (p.cond === 'windy') wind = Math.max(wind, 0.75);
  if (p.cond === 'blizzard') wind = Math.max(wind, 0.8);
  const night = p.phase === 'night';
  const dry = !raining && !(p.cond in SNOWY);
  return {
    rain: raining ? Math.min(1.25, Math.max(0.08, Math.sqrt(rate / 16))) : 0,
    drizzle: p.cond === 'drizzle' ? 1 : 0,
    snow: SNOWY[p.cond] ?? 0,
    hail: p.cond === 'hail' ? 1 : 0,
    fog: p.group === 'fog' ? (p.cond === 'fog' ? 1 : 0.6) : 0,
    white: p.cond === 'blizzard' ? 1 : p.cond === 'heavySnow' ? 0.35 : 0,
    storm: p.group === 'storm' ? 1 : 0,
    torrent: p.cond === 'torrentialRain' ? 1 : 0,
    freeze: p.cond === 'freezingRain' ? 1 : 0,
    heat: p.cond === 'hot' && !night ? 1 : 0,
    wind,
    windMph: Math.max(p.wind ?? 0, wind * 50),
    slant: Math.min(0.95, wind * 1.1) * towards,
    towards,
    leaves: dry && !night ? Math.max(0, Math.min(1, (wind * 50 - 18) / 26)) : 0,
    cloud: p.group === 'clear' || p.group === 'hot' ? Math.min(p.cloud, 8) : p.cloud,       // a clear sky keeps one or two small clouds
    heavy: ['rain', 'torrent', 'freezing', 'storm', 'snow', 'blizzard', 'fog'].includes(p.group) || p.cloud > 85 ? 1 : 0,
    stars: night && BRIGHT.has(p.group) ? 1 : 0,
    glow: !night && BRIGHT.has(p.group) ? 1 : 0,
    moon: night && BRIGHT.has(p.group) ? 1 : 0,
    warm: p.phase !== 'day' && BRIGHT.has(p.group) ? 1 : 0,
  };
}
/* how fast each eases to its target (seconds to get most of the way) */
const TAU = { rain: 1.6, drizzle: 1.6, snow: 2, hail: 1.4, fog: 3, white: 2.5, storm: 1.5, torrent: 1.8, freeze: 2, heat: 3, wind: 2.5, windMph: 2.5, slant: 2, leaves: 2.5, cloud: 3, heavy: 3, stars: 2.5, glow: 2.5, moon: 2.5, warm: 2.5 };
const toneOf = (p) => (p.phase === 'night' ? 'night' : p.phase !== 'day' && BRIGHT.has(p.group) ? 'warm'
  : p.group === 'storm' || p.group === 'torrent' ? 'storm' : ['rain', 'freezing'].includes(p.group) ? 'dayDark'
    : ['cloudy', 'snow', 'blizzard', 'fog'].includes(p.group) ? 'dayGrey' : 'day');

/* ── sprites ──────────────────────────────────────────────────────────────── */
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
/* A soft cumulus. A few big rounded masses build the body (each a soft-edged disc, so overlaps
   add density smoothly instead of leaving ridges), small puffs roughen the top edge, then the
   whole cloud is shaded light on top and darker underneath, and blurred. */
function cloudSprite(seed, tone) {
  const W = 560, H = 260;
  const base = document.createElement('canvas');
  base.width = W; base.height = H;
  const g = base.getContext('2d'), r = rng(seed);
  const [lr, lg, lb] = tone.light, [sr, sg, sb] = tone.shade;
  const disc = (x, y, rad, a) => {
    const gr = g.createRadialGradient(x, y, rad * 0.2, x, y, rad);
    gr.addColorStop(0, `rgba(255,255,255,${a})`);
    gr.addColorStop(0.7, `rgba(255,255,255,${a * 0.75})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  };
  const masses = 5 + Math.floor(r() * 3);
  const tops = [];
  for (let i = 0; i < masses; i++) {
    const t = (i + 0.5) / masses;
    const hump = Math.sin(t * Math.PI);
    const x = 70 + t * (W - 140) + (r() - 0.5) * 30;
    const y = H - 72 - hump * 60;
    const rad = Math.min(52 + hump * 62 * (0.75 + r() * 0.45), H - 8 - y);   // never cut off by the canvas edge
    disc(x, y, rad, 0.85);
    tops.push([x, y - rad * 0.7, rad]);
  }
  for (let k = 0; k < 18; k++) {
    const [x, y, rad] = tops[Math.floor(r() * tops.length)];
    disc(x + (r() - 0.5) * rad * 1.2, Math.max(30, y + r() * rad * 0.3), rad * (0.28 + r() * 0.22), 0.6);
  }
  g.save();                                                 // a broad, low base: a squashed disc
  g.translate(W / 2, H - 80);
  g.scale(1, 0.32);
  disc(0, 0, W * 0.38, 0.5);
  g.restore();
  /* shade it: light on top, the shade colour underneath (only where there is cloud) */
  g.globalCompositeOperation = 'source-atop';
  const sh = g.createLinearGradient(0, 30, 0, H - 20);
  sh.addColorStop(0, `rgb(${lr},${lg},${lb})`);
  sh.addColorStop(0.55, `rgb(${(lr * 2 + sr) / 3 | 0},${(lg * 2 + sg) / 3 | 0},${(lb * 2 + sb) / 3 | 0})`);
  sh.addColorStop(1, `rgb(${sr},${sg},${sb})`);
  g.fillStyle = sh;
  g.fillRect(0, 0, W, H);
  /* soften (where the browser can filter a canvas) */
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const o = c.getContext('2d');
  if ('filter' in o) o.filter = 'blur(6px)';
  o.drawImage(base, 0, 0);
  return c;
}
function fogSprite() {
  const W = 900, H = 160, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, H / W, 0, 0);                  // a circle squashed into a long, low bank
  const gr = g.createRadialGradient(W / 2, W / 2, 10, W / 2, W / 2, W / 2);
  gr.addColorStop(0, 'rgba(235,240,245,0.55)');
  gr.addColorStop(1, 'rgba(235,240,245,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, W);
  return c;
}
const TONES = {
  day: { light: [255, 255, 255], shade: [196, 208, 222] },
  dayGrey: { light: [226, 232, 239], shade: [150, 162, 176] },
  dayDark: { light: [170, 180, 192], shade: [98, 108, 122] },
  storm: { light: [128, 136, 148], shade: [58, 64, 76] },
  warm: { light: [255, 226, 210], shade: [176, 150, 160] },
  night: { light: [86, 96, 114], shade: [32, 38, 50] },
};

/* one set of sprites for the page: a card row of skies would otherwise blur sixty cloud canvases */
const SPRITES = {};
const spritesFor = (toneKey) => (SPRITES[toneKey] ||= [1, 2, 3, 4].map((s) => cloudSprite(s * 7919, TONES[toneKey])));
let FOG = null;
const fogOnce = () => (FOG ||= fogSprite());

const LEAF_COLOURS = ['#8A6D3B', '#A0522D', '#6B7F3A', '#C08A3E', '#7A5230'];

export default function SkyBackdrop({ cond = 'cloudy', sun = 30, morning = true, wind = 8, wdir = 240, rate = 0, cloud = 60, contained = false }) {
  const group = skyGroup(cond);
  const phase = skyPhase(sun, morning);
  const [top, bottom] = SKIES[group][phase];
  const bg = `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`;

  /* the gradient: the new one fades in over the old, so a change of sky is never a cut */
  const [layers, setLayers] = useState([{ k: 0, bg }]);
  useEffect(() => {
    setLayers((ls) => (ls[ls.length - 1].bg === bg ? ls : [...ls.slice(-1), { k: ls[ls.length - 1].k + 1, bg }]));
  }, [bg]);

  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const params = useMemo(() => ({ cond, group, phase, wind, wdir, rate, cloud }), [cond, group, phase, wind, wdir, rate, cloud]);
  const paramsRef = useRef(params);
  useEffect(() => { paramsRef.current = params; }, [params]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return undefined;
    const ctx = cv.getContext('2d');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0, dpr = 1, raf = 0, last = performance.now(), clock = 0, onScreen = true;
    const k = contained ? 0.6 : 1;                         // drop, flake and bolt size on a card
    const sp = contained ? 0.45 : 1;                       // and their speed
    const fog = fogOnce();
    /* the smoothed state: starts at the first weather's values, then eases */
    const cur = { ...targetsOf(paramsRef.current) };
    let tone = { from: toneOf(paramsRef.current), to: toneOf(paramsRef.current), mix: 1 };
    let pools = null;
    let flash = { a: 0, next: 4, bolt: null };

    const resize = () => {
      if (contained) {
        const r = wrapRef.current.getBoundingClientRect();
        W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
        dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      } else {
        dpr = Math.min(window.devicePixelRatio || 1, W > 900 ? 1.5 : 1.25);
        W = window.innerWidth; H = window.innerHeight;
      }
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = `${W}px`; cv.style.height = `${H}px`;
      pools = makePools();
    };
    /* every particle the sky can ever need, made once for this size; the weather only decides how
       many of each are drawn, so more rain is more of the same drops and nothing reshuffles */
    const makePools = () => {
      const area = contained ? Math.max(0.03, (W * H) / (1440 * 900)) : Math.min(1.6, Math.max(0.35, (W * H) / (1440 * 900)));
      const r = rng(Math.round(W + H * 3));
      const n = (x) => Math.max(1, Math.round(x * area));
      return {
        area,
        stars: Array.from({ length: contained ? Math.max(12, Math.round(420 * area)) : n(150) }, () => ({ x: r() * W, y: r() * H * 0.62, s: (0.5 + r() * 1.3) * (contained ? 0.8 : 1), ph: r() * 6.3, sp: 0.6 + r() * 1.8 })),
        clouds: Array.from({ length: contained ? 10 : 18 }, (_, i) => {
          const far = i % 3 !== 0;
          const pad = contained ? W * 0.6 : 300;
          return {
            i, far, a: 0, sprite: i % 4,
            sc: (far ? 0.55 + r() * 0.35 : 0.95 + r() * 0.6) * (contained ? Math.max(0.24, Math.min(0.55, W / 640)) : Math.max(0.7, Math.min(1.4, W / 1100))),
            x: r() * (W + pad * 2) - pad, yf: far ? r() * 0.32 : 0.04 + r() * 0.5, v: (far ? 0.45 : 1) * (0.7 + r() * 0.6),
          };
        }),
        near: Array.from({ length: n(760) }, () => ({ x: r() * W, y: r() * H, l: 0.7 + r() * 0.6, v: 0.8 + r() * 0.5 })),
        far: Array.from({ length: n(2300) }, () => ({ x: r() * W, y: r() * H, l: 0.6 + r() * 0.8, v: 0.5 + r() * 0.25 })),
        flakes: Array.from({ length: n(760) }, () => ({ x: r() * W, y: r() * H, s: (0.8 + r() * 2.9) * (contained ? 0.75 : 1), v: 0.7 + r() * 0.5, ph: r() * 6.3 })),
        stones: Array.from({ length: n(150) }, () => ({ x: r() * W, y: r() * H, l: (5 + r() * 6) * k, v: 0.8 + r() * 0.5, w: 1.6 + r() * 1.6 })),
        fogs: Array.from({ length: 5 }, (_, i) => ({ x: r() * W, y: H * (0.35 + i * 0.13), sc: (1 + r() * 0.8) * (contained ? 0.35 : 1), v: (6 + r() * 8) * (contained ? 0.4 : 1) })),
        gusts: Array.from({ length: n(34) }, () => ({ x: r() * W, y: r() * H, l: (80 + r() * 160) * k, v: 0.7 + r() * 0.6, ph: r() * 6.3, a: 0.4 + r() * 0.6 })),
        leaves: Array.from({ length: n(26) }, () => ({ x: r() * W, y: r() * H, s: (2.4 + r() * 2.4) * k, rot: r() * 6.3, spin: (r() - 0.5) * 9, v: 0.6 + r() * 0.8, ph: r() * 6.3, c: LEAF_COLOURS[Math.floor(r() * LEAF_COLOURS.length)] })),
        splashes: Array.from({ length: n(140) }, () => ({ x: r() * W, y: H * (0.8 + r() * 0.2), t: r(), v: 1.4 + r() * 1.6 })),
        sheets: Array.from({ length: 5 }, () => ({ x: r() * W, w: (W * (0.12 + r() * 0.2)), v: 0.5 + r() * 0.5 })),
      };
    };

    const frame = (now) => {
      if (!onScreen) { raf = 0; return; }
      if (contained && !reduce && now - last < 32) { raf = requestAnimationFrame(frame); return; }   // ~30 fps on a card
      const p = paramsRef.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      /* ease every quantity toward this weather's value; reduced motion goes straight there */
      const tgt = targetsOf(p);
      for (const key of Object.keys(TAU)) cur[key] = reduce ? tgt[key] : cur[key] + (tgt[key] - cur[key]) * (1 - Math.exp(-dt / TAU[key]));
      cur.towards = tgt.towards;
      const tTone = toneOf(p);
      if (tTone !== tone.to) tone = { from: tone.mix >= 0.5 ? tone.to : tone.from, to: tTone, mix: 0 };
      tone.mix = reduce ? 1 : Math.min(1, tone.mix + dt / 2.2);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const P = pools;

      /* stars, then the sun's glow or the moon */
      if (cur.stars > 0.01) {
        ctx.fillStyle = '#ffffff';
        for (const s of P.stars) {
          ctx.globalAlpha = cur.stars * (0.35 + 0.5 * (0.5 + 0.5 * Math.sin(clock * s.sp + s.ph)));
          ctx.fillRect(s.x, s.y, s.s, s.s);
        }
        ctx.globalAlpha = 1;
      }
      if (cur.glow > 0.01) {
        const day = p.phase === 'day' && cur.warm < 0.5;
        const gx = W * 0.82, gy = H * (day ? 0.1 : 0.42), gr = Math.max(W, H) * (0.55 + 0.15 * cur.heat);
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
        const w = cur.warm, ht = cur.heat;
        g.addColorStop(0, `rgba(255,${Math.round(250 - 36 * w - 30 * ht)},${Math.round(225 - 55 * w - 70 * ht)},${(0.5 + 0.05 * w + 0.15 * ht) * cur.glow})`);
        g.addColorStop(0.25, `rgba(255,${Math.round(245 - 55 * w - 40 * ht)},${Math.round(210 - 70 * w - 70 * ht)},${(0.14 + 0.04 * w + 0.1 * ht) * cur.glow})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      if (cur.moon > 0.01 && !contained) {          // a card's symbol already carries the moon
        const mx = W * 0.8, my = H * 0.13, mr = Math.max(16, Math.min(30, W / 50));
        ctx.globalAlpha = cur.moon;
        const g = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 6);
        g.addColorStop(0, 'rgba(220,230,255,0.22)');
        g.addColorStop(1, 'rgba(220,230,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(mx - mr * 6, my - mr * 6, mr * 12, mr * 12);
        ctx.fillStyle = 'rgba(244,246,255,0.92)';
        ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }

      /* clouds: as many as the cover asks for fade in or out, drifting downwind faster the windier
         it is, and their shade cross-fades */
      const towards = cur.towards;
      const drift = (6 + Math.min(70, cur.windMph) * 1.25) * towards * (contained ? 0.45 : 1);
      const showN = cur.cloud <= 1 ? 0 : Math.max(1, (0.5 + (cur.cloud / 100) * 15.5) * Math.min(1.3, P.area + 0.2));
      const spritesFrom = spritesFor(tone.from), spritesTo = spritesFor(tone.to);
      for (const far of [true, false]) {
        for (const c of P.clouds) {
          if (c.far !== far) continue;
          const want = c.i < showN ? (c.i + 1 <= showN ? 1 : showN - c.i) : 0;
          c.a += ((want * (cur.heavy > 0.5 ? 0.85 : far ? 0.55 : 0.85)) - c.a) * (reduce ? 1 : 1 - Math.exp(-dt / 2));
          const sc = c.sc * (1 + 0.3 * cur.heavy);
          const img = spritesTo[c.sprite];
          const w = img.width * sc * 0.62, h = img.height * sc * 0.62;
          c.x += drift * c.v * dt;
          if (towards > 0 && c.x > W + 40) c.x = -w - 40;
          if (towards < 0 && c.x < -w - 40) c.x = W + 40;
          if (c.a < 0.01) continue;
          const y = c.yf * H * (0.75 + 0.15 * cur.heavy);
          if (tone.mix < 1) { ctx.globalAlpha = c.a * (1 - tone.mix); ctx.drawImage(spritesFrom[c.sprite], c.x, y, w, h); }
          ctx.globalAlpha = c.a * tone.mix;
          ctx.drawImage(img, c.x, y, w, h);
        }
      }
      ctx.globalAlpha = 1;

      /* fog banks */
      if (cur.fog > 0.01) {
        ctx.globalAlpha = cur.fog;
        for (const f of P.fogs) {
          f.x += f.v * dt * towards;
          const w = fog.width * f.sc, h = fog.height * f.sc;
          if (f.x > W + w) f.x = -w;
          if (f.x < -w * 1.5) f.x = W;
          ctx.drawImage(fog, f.x - w / 2, f.y - h / 2, w, h);
        }
        ctx.globalAlpha = 1;
      }

      /* gust streaks: long pale lines racing downwind once the wind is strong */
      const gustA = Math.max(0, (cur.wind - 0.35) / 0.65) * (1 + cur.white);
      if (gustA > 0.01) {
        ctx.lineCap = 'round';
        ctx.lineWidth = 1.2 * k;
        ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.26, 0.1 * gustA)})`;
        ctx.beginPath();
        const vx = (700 + 700 * cur.wind) * sp * towards;
        for (const g of P.gusts) {
          g.x += vx * g.v * dt;
          if (towards > 0 && g.x - g.l > W) { g.x = -Math.random() * W * 0.5; g.y = Math.random() * H; }
          if (towards < 0 && g.x + g.l < 0) { g.x = W + Math.random() * W * 0.5; g.y = Math.random() * H; }
          const wob = Math.sin(clock * 1.7 + g.ph) * 6 * k;
          ctx.moveTo(g.x, g.y + wob);
          ctx.quadraticCurveTo(g.x - (g.l / 2) * towards, g.y + wob - 5 * k, g.x - g.l * towards, g.y + wob);
        }
        ctx.stroke();
      }

      /* rain: a far curtain of fine streaks behind nearer, longer, brighter drops. The amount, speed,
         length and slant all follow the smoothed rain and wind, and the wind comes in surges */
      if (cur.rain > 0.005) {
        const R = cur.rain, Rc = Math.min(R, 1.2);
        const surge = 1 + 0.28 * cur.wind * Math.sin(clock * 0.9) * Math.sin(clock * 0.37 + 1);
        const slant = cur.slant * surge;
        const dz = cur.drizzle;
        const speed = (900 + 520 * Rc) * sp * (1 - 0.4 * dz) * (0.9 + 0.1 * surge);
        const frz = cur.freeze;
        const nearN = Math.floor(P.near.length * Math.min(1, 0.1 + 0.75 * R));
        const farN = Math.floor(P.far.length * Math.min(1, Math.max(0, (R - 0.12) * 1.05)));
        ctx.lineCap = 'round';
        const layer = (list, count, lenBase, lenGain, alpha, lw) => {
          ctx.strokeStyle = `rgba(${Math.round(210 - 10 * frz)},${Math.round(225 + 15 * frz)},${Math.round(245 + 10 * frz)},${alpha})`;
          ctx.lineWidth = lw;
          ctx.beginPath();
          for (let i = 0; i < count; i++) {
            const d = list[i];
            d.y += speed * d.v * dt;
            d.x += speed * d.v * dt * slant;
            if (d.y > H + 20) { d.y = -20 - Math.random() * 60; d.x = Math.random() * (W + 200) - 100; }
            if (d.x > W + 50) d.x -= W + 100;
            if (d.x < -50) d.x += W + 100;
            const len = (lenBase + lenGain * Rc) * k * d.l * (1 - 0.45 * dz);
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(d.x - len * slant, d.y - len);
          }
          ctx.stroke();
        };
        if (farN > 0) layer(P.far, farN, 5, 10, 0.09 + 0.13 * Math.min(R, 1), 0.8);
        layer(P.near, nearN, 9, 22, (0.26 + 0.2 * Math.min(R, 1)) * (cur.storm > 0.5 ? 1.08 : 1), (1.15 + 0.25 * Math.min(R, 1)) * (1 - 0.3 * dz));

        /* torrential: hanging sheets sweeping downwind, spray kicked up along the bottom */
        if (cur.torrent > 0.01) {
          for (const s of P.sheets) {
            s.x += (60 + 160 * cur.wind) * s.v * dt * towards;
            if (s.x > W + s.w) s.x = -s.w; if (s.x < -s.w * 2) s.x = W;
            const g = ctx.createLinearGradient(s.x, 0, s.x + s.w, 0);
            g.addColorStop(0, 'rgba(210,222,238,0)'); g.addColorStop(0.5, `rgba(210,222,238,${0.07 * cur.torrent})`); g.addColorStop(1, 'rgba(210,222,238,0)');
            ctx.fillStyle = g;
            ctx.save(); ctx.transform(1, 0, -slant, 1, H * slant * 0.5, 0); ctx.fillRect(s.x, 0, s.w, H); ctx.restore();
          }
          ctx.strokeStyle = `rgba(225,235,250,${0.45 * cur.torrent})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          const nS = Math.floor(P.splashes.length * cur.torrent);
          for (let i = 0; i < nS; i++) {
            const s = P.splashes[i];
            s.t += dt * s.v;
            if (s.t > 1) { s.t = 0; s.x = Math.random() * W; s.y = H * (0.8 + Math.random() * 0.2); }
            const u = s.t, hgt = 9 * k * Math.sin(Math.PI * u), wd = 7 * k * u;
            ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - wd, s.y - hgt);
            ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + wd, s.y - hgt);
          }
          ctx.stroke();
        }
        /* a downpour hangs spray low in the sky */
        if (R > 0.45) {
          const h0 = H * 0.35, a = Math.min(0.26, 0.1 + 0.16 * (R - 0.45) + 0.06 * cur.torrent);
          const g = ctx.createLinearGradient(0, h0, 0, H);
          g.addColorStop(0, 'rgba(200,212,228,0)');
          g.addColorStop(1, `rgba(200,212,228,${a.toFixed(3)})`);
          ctx.fillStyle = g;
          ctx.fillRect(0, h0, W, H - h0);
        }
        /* freezing rain: the edges ice over */
        if (frz > 0.01) {
          const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
          g.addColorStop(0, 'rgba(220,240,255,0)');
          g.addColorStop(1, `rgba(220,240,255,${0.22 * frz})`);
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
        }
      }

      /* snow: drifting and swaying, nearer flakes bigger, brighter, faster; driven sideways by the
         wind, and in a blizzard nearly level and drawn as streaks */
      if (cur.snow > 0.005) {
        const n = Math.floor(P.flakes.length * Math.min(1, cur.snow));
        const push = cur.wind * 360 * towards * sp;
        for (let i = 0; i < n; i++) {
          const f = P.flakes[i];
          const near = f.s / 3.7;
          f.y += (30 + 55 * near) * f.v * dt * (contained ? 0.6 : 1) * (1 + 0.6 * cur.snow);
          f.x += (Math.sin(clock * 0.9 + f.ph) * (8 + 16 * near) * (1 - cur.wind) + drift * (0.3 + 0.5 * near) + push * (0.4 + 0.8 * near)) * dt;
          if (f.y > H + 10) { f.y = -10; f.x = Math.random() * W; }
          if (f.x > W + 10) f.x = -10;
          if (f.x < -10) f.x = W + 10;
        }
        const streak = Math.abs(push) > 120;
        for (const [lo, hi, alpha, glow] of [[0, 1.7, 0.45, 0], [1.7, 2.7, 0.75, 0], [2.7, 9, 0.95, 5]]) {
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const f = P.flakes[i];
            if (f.s < lo || f.s >= hi) continue;
            if (streak) { ctx.moveTo(f.x, f.y); ctx.lineTo(f.x - push * 0.025 * (0.4 + f.s / 3), f.y - 3 * k); }
            else { ctx.moveTo(f.x + f.s, f.y); ctx.arc(f.x, f.y, f.s, 0, Math.PI * 2); }
          }
          if (streak) { ctx.strokeStyle = `rgba(255,255,255,${alpha})`; ctx.lineWidth = Math.max(1.2, (lo + hi) / 2 * 0.9); ctx.lineCap = 'round'; ctx.stroke(); }
          else {
            ctx.fillStyle = `rgba(255,255,255,${alpha})`;
            if (glow) { ctx.shadowColor = 'rgba(255,255,255,0.85)'; ctx.shadowBlur = glow; }
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
      }
      /* a whiteout: the air itself goes white */
      if (cur.white > 0.01) {
        ctx.fillStyle = `rgba(236,241,246,${0.2 * cur.white})`;
        ctx.fillRect(0, 0, W, H);
      }

      /* hail: hard white pellets, much faster than snow, short bright streaks down the wind */
      if (cur.hail > 0.01) {
        const n = Math.floor(P.stones.length * cur.hail);
        const slant = Math.min(0.35, cur.wind * 0.6) * towards;
        for (let i = 0; i < n; i++) {
          const s2 = P.stones[i];
          s2.y += 760 * s2.v * dt * sp;
          s2.x += 760 * s2.v * dt * slant * sp;
          if (s2.y > H + 12) { s2.y = -12 - Math.random() * 40; s2.x = Math.random() * (W + 200) - 100; }
          if (s2.x > W + 30) s2.x -= W + 60;
          if (s2.x < -30) s2.x += W + 60;
        }
        ctx.strokeStyle = `rgba(238,246,255,${0.92 * Math.min(1, cur.hail)})`;
        ctx.lineCap = 'round';
        for (const [lo, hi, lw] of [[0, 2.4, 2], [2.4, 9, 3]]) {
          ctx.lineWidth = lw;
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const s2 = P.stones[i];
            if (s2.w < lo || s2.w >= hi) continue;
            ctx.moveTo(s2.x, s2.y);
            ctx.lineTo(s2.x - s2.l * slant, s2.y - s2.l);
          }
          ctx.stroke();
        }
      }

      /* blown leaves on a dry, windy day */
      if (cur.leaves > 0.01) {
        const n = Math.floor(P.leaves.length * cur.leaves);
        const vx = (220 + 520 * cur.wind) * sp * towards;
        for (let i = 0; i < n; i++) {
          const l = P.leaves[i];
          l.x += vx * l.v * dt;
          l.y += (Math.sin(clock * 2 + l.ph) * 50 + 18) * dt * sp;
          l.rot += l.spin * dt;
          if (towards > 0 && l.x > W + 20) { l.x = -20; l.y = Math.random() * H; }
          if (towards < 0 && l.x < -20) { l.x = W + 20; l.y = Math.random() * H; }
          if (l.y > H + 20) l.y = -20;
          ctx.save();
          ctx.translate(l.x, l.y); ctx.rotate(l.rot); ctx.scale(1, Math.abs(Math.sin(l.rot * 0.7)) * 0.7 + 0.3);
          ctx.globalAlpha = 0.8 * Math.min(1, cur.leaves * 1.5);
          ctx.fillStyle = l.c;
          ctx.beginPath(); ctx.ellipse(0, 0, l.s * 1.6, l.s * 0.75, 0, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }

      /* heat shimmer low over a hot day */
      if (cur.heat > 0.01) {
        const g = ctx.createLinearGradient(0, H * 0.55, 0, H);
        g.addColorStop(0, 'rgba(255,170,90,0)');
        g.addColorStop(1, `rgba(255,170,90,${0.14 * cur.heat})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, H * 0.55, W, H * 0.45);
        ctx.strokeStyle = `rgba(255,236,210,${0.07 * cur.heat})`;
        ctx.lineWidth = 2 * k;
        for (let b = 0; b < 4; b++) {
          const y0 = H * (0.72 + b * 0.07);
          ctx.beginPath();
          for (let x = 0; x <= W; x += 18) {
            const y = y0 + Math.sin(x * 0.02 + clock * (1.4 + b * 0.3)) * 3 * k;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      /* lightning: a double flicker every few seconds, sometimes with a visible bolt */
      if (cur.storm > 0.3 && !reduce) {
        flash.next -= dt;
        if (flash.next <= 0) {
          flash = { a: 0.55, next: 3 + Math.random() * 7, bolt: Math.random() < 0.55 ? makeBolt(W, H) : null, age: 0 };
        }
        if (flash.a > 0.01) {
          flash.age = (flash.age || 0) + dt;
          const flick = flash.age < 0.08 || (flash.age > 0.14 && flash.age < 0.22) ? 1 : 0.35;
          ctx.fillStyle = `rgba(225,232,255,${flash.a * flick * 0.6 * cur.storm})`;
          ctx.fillRect(0, 0, W, H);
          if (flash.bolt && flash.age < 0.25) {
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.lineWidth = 2;
            ctx.shadowColor = 'rgba(190,210,255,0.9)';
            ctx.shadowBlur = 18;
            ctx.beginPath();
            flash.bolt.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
          flash.a *= Math.exp(-dt * 5);
        }
      }
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    const makeBolt = (w, h) => {
      let x = w * (0.2 + Math.random() * 0.6), y = 0;
      const pts = [[x, y]];
      while (y < h * (0.45 + Math.random() * 0.25)) { y += (18 + Math.random() * 30) * k; x += (Math.random() - 0.5) * 50 * k; pts.push([x, y]); }
      return pts;
    };

    resize();
    const start = () => { if (!reduce && !raf && onScreen && !document.hidden) { last = performance.now() - 40; raf = requestAnimationFrame(frame); } };
    const onResize = () => { resize(); if (reduce) frame(performance.now()); };
    let ro = null, io = null;
    if (contained) {
      ro = new ResizeObserver(onResize);
      ro.observe(wrapRef.current);
      /* a card off screen stops drawing until it is scrolled back */
      io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; start(); });
      io.observe(wrapRef.current);
    } else window.addEventListener('resize', onResize);
    const onVis = () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else start();
    };
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect(); io?.disconnect();
      if (!contained) window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [contained]);

  /* a reduced-motion reader still gets the new sky when the weather changes */
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) window.dispatchEvent(new Event('resize'));
  }, [params]);

  return (
    <div ref={wrapRef} aria-hidden="true" style={{ position: contained ? 'absolute' : 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {layers.map((l, i) => (
        <div key={l.k} className={i ? 'lw-sky-in' : undefined} style={{ position: 'absolute', inset: 0, background: l.bg }} />
      ))}
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
      {/* depth: a little darker at the very top and bottom, the way a real sky reads behind glass */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 70%, rgba(0,0,0,0.22) 100%)' }} />
    </div>
  );
}

/* ── rain on the cards ──────────────────────────────────────────────────────────
   While it rains, drops land on the top edge of the page's first row of glass cards and bounce
   off it in a few fine beads, the way they do on the iPhone's weather cards: the three cards
   side by side on a wide screen, the one card on a phone (whichever cards share the highest top).
   One fixed canvas over the page draws them at the cards' edges as the page scrolls, with the
   row found again every second, so a change of layout is followed. Nothing is drawn for snow,
   or for readers who ask their system for reduced motion. */
const SPLASH_CONDS = new Set(['rain', 'heavyRain', 'showers', 'heavyShowers', 'lightRain', 'drizzle', 'thunder', 'thunderShowers', 'hail', 'sleet', 'torrentialRain', 'freezingRain']);
export function CardRain({ cond, rate = 0, wind = 0, wdir = 240, selector = '.lw-grid .lw-col > .lw-glass, .lw-grid .lw-tiles > .lw-glass' }) {
  const on = SPLASH_CONDS.has(cond);
  const cvRef = useRef(null);
  const pRef = useRef({ cond, rate, wind, wdir });
  useEffect(() => { pRef.current = { cond, rate, wind, wdir }; }, [cond, rate, wind, wdir]);
  useEffect(() => {
    const cv = cvRef.current;
    if (!on || !cv || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const ctx = cv.getContext('2d');
    let W = 0, H = 0, dpr = 1, raf = 0, last = performance.now();
    let cards = [], radius = 22;
    /* everything is kept relative to its card (x from its left, y from its top edge, up negative) */
    let drops = [], beads = [], marks = [];
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = window.innerWidth; H = window.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    };
    const find = () => {
      const all = [...document.querySelectorAll(selector)];
      const tops = all.map((el) => el.getBoundingClientRect().top);
      const min = Math.min(...tops);
      cards = all.filter((_, i) => tops[i] - min < 6);
      if (cards[0]) radius = parseFloat(getComputedStyle(cards[0]).borderTopLeftRadius) || 22;
    };
    const splash = (e, x, inten, slant) => {
      marks.push({ e, x, age: 0, w: 3 + Math.random() * (4 + 6 * inten) });
      const n = 2 + Math.floor(Math.random() * (2 + 3 * inten));
      for (let i = 0; i < n && beads.length < 700; i++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        beads.push({
          e, x, y: -0.5, bounced: false,
          vx: side * (35 + Math.random() * (60 + 80 * inten)) + slant * 90,
          vy: -(60 + Math.random() * (100 + 130 * inten)),
          r: 0.55 + Math.random() * (0.6 + 0.6 * inten),
        });
      }
    };
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const p = pRef.current;
      const inten = p.cond === 'drizzle' ? 0.12 : Math.min(1, Math.sqrt(Math.max(0.3, p.rate ?? 0) / 8));
      const towards = Math.sin(((p.wdir ?? 240) + 180) * (Math.PI / 180)) >= 0 ? 1 : -1;
      const slant = Math.min(0.5, (p.wind ?? 0) / 60) * towards;
      const rects = cards.map((el) => el.getBoundingClientRect());
      /* new drops over each edge in view, more the harder it rains */
      rects.forEach((r, e) => {
        const len = r.width - 2 * radius;
        if (len <= 0 || r.top < -10 || r.top > H + 10) return;
        for (let n = len * (0.01 + 0.085 * inten) * dt; n > 0 && drops.length < 320; n -= 1) {
          if (n < 1 && Math.random() > n) break;
          const y = -(16 + Math.random() * 80);                 // starts upwind, so it lands where it was aimed
          drops.push({ e, x: radius + Math.random() * len + slant * y, y, v: 1000 + Math.random() * 400, l: 9 + Math.random() * 9 });
        }
      });
      for (const d of drops) {
        d.y += d.v * dt;
        d.x += d.v * slant * dt;
        if (d.y >= 0) {
          const w = rects[d.e]?.width ?? 0;
          if (d.x >= radius && d.x <= w - radius) splash(d.e, d.x, inten, slant);
          d.dead = true;
        }
      }
      drops = drops.filter((d) => !d.dead);
      for (const b of beads) {
        b.vy += 900 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.y >= 0 && b.vy > 0) {
          const w = rects[b.e]?.width ?? 0;
          const onGlass = b.x >= 2 && b.x <= w - 2;
          if (onGlass && !b.bounced && b.r > 1) { b.y = -0.2; b.vy *= -0.28; b.vx *= 0.6; b.bounced = true; }
          else if (onGlass || b.y > 40) b.dead = true;
        }
      }
      beads = beads.filter((b) => !b.dead);
      for (const m of marks) m.age += dt;
      marks = marks.filter((m) => m.age < 0.16);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(226,236,250,0.5)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (const d of drops) {
        const r = rects[d.e];
        if (!r) continue;
        const X = r.left + d.x, Y = r.top + d.y;
        ctx.moveTo(X, Y);
        ctx.lineTo(X - d.l * slant, Y - d.l);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(236,244,255,0.9)';
      ctx.beginPath();
      for (const b of beads) {
        const r = rects[b.e];
        if (!r) continue;
        const X = r.left + b.x, Y = r.top + b.y;
        ctx.moveTo(X + b.r, Y);
        ctx.arc(X, Y, b.r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.fillStyle = 'rgba(244,249,255,0.75)';
      for (const m of marks) {
        const r = rects[m.e];
        if (!r) continue;
        ctx.globalAlpha = 1 - m.age / 0.16;
        ctx.beginPath();
        ctx.ellipse(r.left + m.x, r.top + 0.5, (m.w / 2) * (1 + m.age * 4), 1.1, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    resize();
    find();
    const refind = setInterval(find, 1000);
    const start = () => { if (!raf && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    const onVis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else start(); };
    const onResize = () => { resize(); find(); };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    start();
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(refind);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [on, selector]);
  if (!on) return null;
  return <canvas ref={cvRef} aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 2, pointerEvents: 'none' }} />;
}

/* ── rain on the cards, as on a window ─────────────────────────────────────────
   While it rains, every glass card on the page is a wet window: drops land on it, behind its
   text, in a scatter of fine beads and a few bigger drops; the big ones run down the glass,
   blown sideways by the wind, gathering up the beads in their path and leaving a faint trail,
   and the rest slowly dry off. The heavier the rain and the stronger the wind, the faster they
   land and the more there are. When the rain stops, no new drops land and the glass dries, so
   it never cuts off.

   Each card gets a canvas of its own as its first child, under its content (z-index -1 inside
   the card's own stacking context, which its backdrop blur gives it), softly out of focus so
   the card's numbers stay easy to read. One loop draws the cards
   in view at about 30 frames a second, from a droplet sprite made once. Nothing is drawn for
   readers who ask their system for reduced motion. */
const WINDOW_RAIN = { drizzle: 0.25, lightRain: 0.5, rain: 2, heavyRain: 6, showers: 1.5, heavyShowers: 6, torrentialRain: 22, freezingRain: 1.5, thunder: 6, thunderShowers: 4, sleet: 1, hail: 3 };
let DROP = null;
function dropSprite() {
  if (DROP) return DROP;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), r = 26, cx = 32, cy = 32;
  /* a lens: the sky seen upside down through it, so lighter at the bottom, a bright rim, a dark
     shadow under it and a highlight top left */
  const body = g.createLinearGradient(0, cy - r, 0, cy + r);
  body.addColorStop(0, 'rgba(8,16,30,0.42)');
  body.addColorStop(0.5, 'rgba(255,255,255,0.14)');
  body.addColorStop(1, 'rgba(255,255,255,0.62)');
  g.fillStyle = body;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.lineWidth = 2.8; g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.beginPath(); g.arc(cx, cy, r - 1.2, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 3.6; g.strokeStyle = 'rgba(0,0,0,0.32)';
  g.beginPath(); g.arc(cx, cy + 1.6, r - 0.4, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath(); g.ellipse(cx - r * 0.36, cy - r * 0.42, r * 0.22, r * 0.13, -0.6, 0, Math.PI * 2); g.fill();
  DROP = c;
  return c;
}

export function WindowRain({ cond, rate = 0, wind = 0, wdir = 240, selector = '.lw-wrap .lw-glass' }) {
  const wet = cond in WINDOW_RAIN;
  const pRef = useRef({ cond, rate, wind, wdir, wet });
  useEffect(() => { pRef.current = { cond, rate, wind, wdir, wet }; }, [cond, rate, wind, wdir, wet]);
  const [live, setLive] = useState(wet);                  // stays on after the rain while the glass dries
  useEffect(() => { if (wet) setLive(true); }, [wet]);

  useEffect(() => {
    if (!live || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const sprite = dropSprite();
    const cards = new Map();                               // card element -> its glass
    let raf = 0, last = performance.now(), acc = 0, I = 0, Wd = 0, idleFor = 0;
    const io = new IntersectionObserver((es) => { for (const e of es) { const c = cards.get(e.target); if (c) c.visible = e.isIntersecting; } });
    const ro = new ResizeObserver((es) => { for (const e of es) { const c = cards.get(e.target); if (c) size(c); } });
    const size = (c) => {
      const r = c.el.getBoundingClientRect();
      c.w = Math.max(1, Math.round(r.width)); c.h = Math.max(1, Math.round(r.height));
      c.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      c.cv.width = Math.round(c.w * c.dpr); c.cv.height = Math.round(c.h * c.dpr);
    };
    const attach = () => {
      const els = new Set(document.querySelectorAll(selector));
      for (const el of els) {
        if (cards.has(el)) continue;
        const cv = document.createElement('canvas');
        cv.className = 'lw-window-rain';
        cv.setAttribute('aria-hidden', 'true');
        /* out of focus, as drops on a window behind the card's text are: they show it is raining
           without getting in the way of the numbers (sharp drops made them hard to read) */
        cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;border-radius:inherit;filter:blur(2px);opacity:.62;';
        el.prepend(cv);
        const c = { el, cv, ctx: cv.getContext('2d'), beads: [], visible: true, w: 1, h: 1, dpr: 1 };
        cards.set(el, c);
        size(c);
        io.observe(el); ro.observe(el);
      }
      for (const [el, c] of cards) if (!els.has(el) || !el.isConnected) { c.cv.remove(); io.unobserve(el); ro.unobserve(el); cards.delete(el); }
    };
    attach();
    const refind = setInterval(attach, 1500);

    const step = (c, dt, spawning, slant) => {
      const { w, h } = c;
      const unit = (w * h) / 10000;
      /* new drops land: more and bigger in heavier rain and stronger wind */
      if (spawning) {
        const cap = Math.min(520, (w * h) / 650 * (0.3 + 1.0 * Math.min(I, 1.2)) * (1 + 0.5 * Wd));
        for (let n = unit * (1.2 + 11 * I) * (1 + 0.8 * Wd) * dt; n > 0 && c.beads.length < cap; n -= 1) {
          if (n < 1 && Math.random() > n) break;
          const big = Math.random() < 0.03 + 0.06 * Math.min(I, 1);
          const r = big ? 3.4 + Math.random() * (2 + 2.2 * Math.min(I, 1)) : 1 + Math.random() ** 1.8 * (1.6 + 2.6 * Math.min(I, 1));
          c.beads.push({ x: Math.random() * w, y: Math.random() * h, r, age: 0, life: 7 + Math.random() * 14, run: big ? 0.3 + Math.random() * 1.6 : -1, vy: 0, tx: 0, ty: 0 });
        }
      }
      for (const b of c.beads) {
        b.age += dt;
        if (b.run >= 0 && b.age > b.run) {
          /* a runner: it slides down, pushed sideways by the wind, now and then catching */
          if (!b.vy) { b.tx = b.x; b.ty = b.y; }
          const target = (38 + 70 * b.r / 4) * (Math.sin(b.age * 3 + b.x) > -0.85 ? 1 : 0.15);
          b.vy += (target - b.vy) * Math.min(1, dt * 4);
          b.y += b.vy * dt;
          b.x += b.vy * slant * 0.55 * dt;
          for (const o of c.beads) {
            if (o === b || o.run >= 0 || o.dead) continue;
            const dx = o.x - b.x, dy = o.y - b.y;
            if (dx * dx + dy * dy < (b.r + o.r + 1) ** 2) { o.dead = true; b.r = Math.min(5.2, b.r + o.r * 0.12); }
          }
          if (Math.random() < dt * 3) c.beads.push({ x: b.x + (Math.random() - 0.5) * b.r, y: b.y - b.r * 2.6, r: 0.7 + Math.random() * 1.1, age: 0.2, life: 3 + Math.random() * 5, run: -1, vy: 0, tx: 0, ty: 0 });   // beads left behind
          if (b.y - b.r > h + 4) b.dead = true;
        } else if (b.age > b.life) b.dead = true;
      }
      c.beads = c.beads.filter((b) => !b.dead);
    };
    const draw = (c) => {
      const { ctx } = c;
      ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
      ctx.clearRect(0, 0, c.w, c.h);
      /* the trails runners leave, then every drop */
      ctx.lineCap = 'round';
      for (const b of c.beads) {
        if (b.run < 0 || !b.vy) continue;
        ctx.strokeStyle = 'rgba(255,255,255,0.16)';
        ctx.lineWidth = b.r * 0.85;
        ctx.beginPath(); ctx.moveTo(b.tx, b.ty); ctx.lineTo(b.x, b.y - b.r); ctx.stroke();
      }
      for (const b of c.beads) {
        const a = Math.min(1, b.age / 0.12) * (b.run >= 0 ? 1 : Math.min(1, (b.life - b.age) / 2.5));
        if (a <= 0.01) continue;
        ctx.globalAlpha = a;
        const stretch = b.run >= 0 && b.vy > 5 ? 1.35 : 1;
        ctx.drawImage(sprite, b.x - b.r, b.y - b.r * stretch, b.r * 2, b.r * 2 * stretch);
      }
      ctx.globalAlpha = 1;
    };

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dtRaw = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dtRaw;
      if (acc < 1 / 30) return;                            // about 30 frames a second
      const dt = Math.min(0.1, acc);
      acc = 0;
      const p = pRef.current;
      const rate = p.rate > 0.05 ? p.rate : WINDOW_RAIN[p.cond] ?? 0;
      const tI = p.wet ? Math.min(1.25, Math.max(0.08, Math.sqrt(rate / 16))) : 0;
      const tW = Math.min(1, (p.wind ?? 0) / 50);
      I += (tI - I) * (1 - Math.exp(-dt / 1.6));
      Wd += (tW - Wd) * (1 - Math.exp(-dt / 2.5));
      const towards = Math.sin(((p.wdir ?? 240) + 180) * (Math.PI / 180)) >= 0 ? 1 : -1;
      const slant = Math.min(0.9, Wd * 1.1) * towards;
      let any = false;
      for (const c of cards.values()) {
        if (!c.visible) continue;
        step(c, dt, p.wet, slant);
        draw(c);
        if (c.beads.length) any = true;
      }
      /* dry: once the glass has cleared for a few seconds, the canvases go */
      idleFor = !p.wet && !any ? idleFor + dt : 0;
      if (idleFor > 3) setLive(false);
    };
    const onVis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(refind);
      io.disconnect(); ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      for (const c of cards.values()) c.cv.remove();
    };
  }, [live, selector]);
  return null;
}
