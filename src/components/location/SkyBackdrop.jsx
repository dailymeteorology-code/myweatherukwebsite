/* The live sky behind the Location page.

   A gradient for the weather and the sun's height (day, dawn, dusk, night), cross-faded when it
   changes, and one canvas on top for what moves: clouds drifting with the wind in two layers,
   stars, the sun's glow or the moon, rain slanting with the wind, snow, hail, fog banks and
   lightning. Everything comes from the hour being shown, so scrubbing through the forecast
   changes the sky.

   Built to stay smooth: one canvas, sprites made once per tone (and shared by every sky on the
   page), every streak of rain in a single path, the pixel ratio capped, nothing drawn while the
   tab is hidden, and a still picture for readers who ask their system for reduced motion.

   `contained` puts the sky inside its parent instead of behind the whole window (the home page's
   city cards): sized to the card, with clouds, drops and flakes scaled to it, drawn at about 30
   frames a second, and paused while the card is off screen. */
import React, { useEffect, useMemo, useRef, useState } from 'react';

const SKIES = {
  clear:  { day: ['#1C66C9', '#79BBF0'], dawn: ['#3B5994', '#F2A67C'], dusk: ['#2B3A70', '#EE8A5B'], night: ['#050B1E', '#1A2C55'] },
  partly: { day: ['#2C68B2', '#91BADF'], dawn: ['#455C8B', '#E5A784'], dusk: ['#34426D', '#DB916F'], night: ['#0A1327', '#24334E'] },
  cloudy: { day: ['#5B6F84', '#A0AFBF'], dawn: ['#5A6780', '#BFA599'], dusk: ['#48536A', '#B28E82'], night: ['#141B26', '#2D3745'] },
  rain:   { day: ['#435468', '#7C8C9C'], dawn: ['#445064', '#8B8490'], dusk: ['#3B4457', '#827880'], night: ['#0F151E', '#252F3E'] },
  storm:  { day: ['#26303D', '#535D69'], dawn: ['#282E3B', '#5B545E'], dusk: ['#222834', '#534E58'], night: ['#080B11', '#1C222B'] },
  snow:   { day: ['#788BA0', '#CAD4DF'], dawn: ['#77839E', '#D5C1BB'], dusk: ['#68738E', '#C2A9A6'], night: ['#1D2632', '#445063'] },
  fog:    { day: ['#8B97A4', '#C7CED6'], dawn: ['#8A91A0', '#CFBBB0'], dusk: ['#78808F', '#BCA59B'], night: ['#252B34', '#454D58'] },
};

export function skyGroup(cond) {
  if (cond === 'thunder') return 'storm';
  if (['snow', 'heavySnow', 'snowShowers', 'sleet', 'hail'].includes(cond)) return 'snow';
  if (['rain', 'heavyRain', 'showers', 'heavyShowers', 'lightRain', 'drizzle'].includes(cond)) return 'rain';
  if (cond === 'fog' || cond === 'mist') return 'fog';
  if (cond === 'cloudy' || cond === 'overcast') return 'cloudy';
  if (cond === 'partly' || cond === 'mostlyClear') return 'partly';
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
  const base = { clear: 0.15, partly: 0.2, cloudy: 0.35, rain: 0.45, storm: 0.65, snow: 0.25, fog: 0.3 }[g];
  return sun < -6 ? Math.max(base, 0.7) : sun < 7 ? Math.max(base, 0.45) : base;
}

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
    const fog = fogOnce();
    let stars = [], clouds = [], drops = [], flakes = [], stones = [], fogs = [];
    let flash = { a: 0, next: 4, bolt: null };
    let built = '';

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
      built = '';
    };
    /* (re)populate when the weather or the window changes */
    const build = (p) => {
      /* how much sky there is: a card gets the same density as the window, so fewer of everything */
      const area = contained ? Math.max(0.03, (W * H) / (1440 * 900)) : Math.min(1.6, Math.max(0.35, (W * H) / (1440 * 900)));
      const r = rng(Math.round(W + H * 3));
      const night = p.phase === 'night';
      stars = night && ['clear', 'partly'].includes(p.group)
        ? Array.from({ length: contained ? Math.max(12, Math.round(420 * area)) : Math.round(150 * area) }, () => ({ x: r() * W, y: r() * H * 0.62, s: (0.5 + r() * 1.3) * (contained ? 0.8 : 1), ph: r() * 6.3, sp: 0.6 + r() * 1.8 }))
        : [];
      const toneKey = night ? 'night' : p.phase !== 'day' && ['clear', 'partly'].includes(p.group) ? 'warm'
        : p.group === 'storm' ? 'storm' : p.group === 'rain' ? 'dayDark' : p.group === 'cloudy' || p.group === 'snow' || p.group === 'fog' ? 'dayGrey' : 'day';
      const sp = spritesFor(toneKey);
      const cover = p.group === 'clear' ? Math.min(p.cloud, 20) : p.cloud;
      /* a clear sky keeps one or two small, distant fair-weather clouds */
      const n = p.group === 'clear' ? Math.max(1, Math.round(1.5 * area)) : Math.round((2 + (cover / 100) * 14) * Math.min(1.3, area + 0.2));
      const heavy = ['rain', 'storm', 'snow', 'fog'].includes(p.group) || cover > 85;
      clouds = Array.from({ length: n }, (_, i) => {
        const far = p.group === 'clear' || i % 3 !== 0;
        const sc = (far ? 0.55 + r() * 0.35 : 0.95 + r() * 0.6) * (contained ? Math.max(0.24, Math.min(0.55, W / 640)) : Math.max(0.7, Math.min(1.4, W / 1100))) * (heavy ? 1.3 : 1);
        const pad = contained ? W * 0.6 : 300;
        return {
          img: sp[i % sp.length], far, sc,
          x: r() * (W + pad * 2) - pad, y: (far ? r() * 0.32 : 0.04 + r() * 0.5) * H * (heavy ? 0.9 : 0.75),
          a: (heavy ? 0.8 : far ? 0.55 : 0.85) * (p.group === 'clear' ? 0.6 : 1), v: (far ? 0.45 : 1) * (0.7 + r() * 0.6),
        };
      }).sort((a, b) => (a.far === b.far ? 0 : a.far ? -1 : 1));
      /* hail comes down with rain; sleet is rain and snow together */
      const wet = ['rain', 'storm'].includes(p.group) || ['sleet', 'hail'].includes(p.cond);
      const nRain = wet ? Math.round((p.cond === 'drizzle' ? 90 : p.cond === 'hail' ? 160 : 120 + Math.min(1, p.rate / 6) * 380) * area) : 0;
      drops = Array.from({ length: nRain }, () => ({ x: r() * W, y: r() * H, l: (10 + r() * 16) * k, v: 0.75 + r() * 0.5 }));
      const snowy = ['snow', 'heavySnow', 'snowShowers', 'sleet'].includes(p.cond);
      const nSnow = snowy ? Math.round((p.cond === 'heavySnow' ? 280 : p.cond === 'sleet' ? 90 : 160) * area) : 0;
      /* flakes in three depths: small, faint and slow far away; big, bright and quicker close by */
      flakes = Array.from({ length: nSnow }, () => ({ x: r() * W, y: r() * H, s: (0.8 + r() * 2.9) * (contained ? 0.75 : 1), v: 0.7 + r() * 0.5, ph: r() * 6.3 }));
      stones = p.cond === 'hail' ? Array.from({ length: Math.round(150 * area) }, () => ({ x: r() * W, y: r() * H, l: (5 + r() * 6) * k, v: 0.8 + r() * 0.5, w: 1.6 + r() * 1.6 })) : [];
      fogs = p.group === 'fog' ? Array.from({ length: 5 }, (_, i) => ({ x: r() * W, y: H * (0.35 + i * 0.13), sc: (1 + r() * 0.8) * (contained ? 0.35 : 1), v: (6 + r() * 8) * (contained ? 0.4 : 1) })) : [];
      built = `${p.cond}|${p.group}|${p.phase}|${Math.round(p.cloud / 10)}|${Math.round(p.rate)}|${W}x${H}`;
    };

    const frame = (now) => {
      if (!onScreen) { raf = 0; return; }
      if (contained && !reduce && now - last < 32) { raf = requestAnimationFrame(frame); return; }   // ~30 fps on a card
      const p = paramsRef.current;
      const key = `${p.cond}|${p.group}|${p.phase}|${Math.round(p.cloud / 10)}|${Math.round(p.rate)}|${W}x${H}`;
      if (key !== built) build(p);
      const dt = reduce ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      /* stars, then the sun's glow or the moon */
      if (stars.length) {
        ctx.fillStyle = '#ffffff';
        for (const s of stars) {
          ctx.globalAlpha = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(clock * s.sp + s.ph));
          ctx.fillRect(s.x, s.y, s.s, s.s);
        }
        ctx.globalAlpha = 1;
      }
      const bright = ['clear', 'partly'].includes(p.group);
      if (bright && p.phase !== 'night') {
        const gx = W * 0.82, gy = H * (p.phase === 'day' ? 0.1 : 0.42), gr = Math.max(W, H) * 0.55;
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
        const warm = p.phase !== 'day';
        g.addColorStop(0, warm ? 'rgba(255,214,170,0.55)' : 'rgba(255,250,225,0.5)');
        g.addColorStop(0.25, warm ? 'rgba(255,190,140,0.18)' : 'rgba(255,245,210,0.14)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      } else if (bright && p.phase === 'night' && !contained) {   // a card's symbol already carries the moon
        const mx = contained ? W * 0.5 : W * 0.8, my = contained ? H * 0.2 : H * 0.13;
        const mr = contained ? Math.max(6, Math.min(12, W / 22)) : Math.max(16, Math.min(30, W / 50));
        const g = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 6);
        g.addColorStop(0, 'rgba(220,230,255,0.22)');
        g.addColorStop(1, 'rgba(220,230,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(mx - mr * 6, my - mr * 6, mr * 12, mr * 12);
        ctx.fillStyle = 'rgba(244,246,255,0.92)';
        ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
      }

      /* clouds, drifting downwind (the far layer slower), wrapping round */
      const towards = Math.sin(((p.wdir ?? 240) + 180) * (Math.PI / 180)) >= 0 ? 1 : -1;
      const drift = (6 + Math.min(60, p.wind ?? 8) * 0.9) * towards * (contained ? 0.45 : 1);
      for (const c of clouds) {
        const w = c.img.width * c.sc * 0.62, h = c.img.height * c.sc * 0.62;
        c.x += drift * c.v * dt;
        if (towards > 0 && c.x > W + 40) c.x = -w - 40;
        if (towards < 0 && c.x < -w - 40) c.x = W + 40;
        ctx.globalAlpha = c.a;
        ctx.drawImage(c.img, c.x, c.y, w, h);
      }
      ctx.globalAlpha = 1;

      /* fog banks */
      for (const f of fogs) {
        f.x += f.v * dt * towards;
        const w = fog.width * f.sc, h = fog.height * f.sc;
        if (f.x > W + w) f.x = -w;
        if (f.x < -w * 1.5) f.x = W;
        ctx.drawImage(fog, f.x - w / 2, f.y - h / 2, w, h);
      }

      /* rain: every streak in one path, slanted downwind */
      if (drops.length) {
        const slant = Math.min(0.5, (p.wind ?? 0) / 60) * towards;
        const speed = (900 + Math.min(1, (p.rate ?? 0) / 6) * 500) * (contained ? 0.45 : 1);
        ctx.strokeStyle = p.group === 'storm' ? 'rgba(200,214,235,0.42)' : 'rgba(210,225,245,0.36)';
        ctx.lineWidth = p.cond === 'drizzle' ? 0.8 : 1.15;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (const d of drops) {
          d.y += speed * d.v * dt;
          d.x += speed * d.v * dt * slant;
          if (d.y > H + 20) { d.y = -20 - Math.random() * 60; d.x = Math.random() * (W + 200) - 100; }
          if (d.x > W + 50) d.x -= W + 100;
          if (d.x < -50) d.x += W + 100;
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.l * slant, d.y - d.l);
        }
        ctx.stroke();
      }
      /* snow (and the snow in sleet): drifting and swaying, nearer flakes bigger, brighter, faster */
      if (flakes.length) {
        for (const f of flakes) {
          const near = f.s / 3.7;
          f.y += (30 + 55 * near) * f.v * dt * (contained ? 0.6 : 1);
          f.x += (Math.sin(clock * 0.9 + f.ph) * (8 + 16 * near) + drift * (0.3 + 0.5 * near)) * dt;
          if (f.y > H + 10) { f.y = -10; f.x = Math.random() * W; }
          if (f.x > W + 10) f.x = -10;
          if (f.x < -10) f.x = W + 10;
        }
        for (const [lo, hi, alpha, glow] of [[0, 1.7, 0.45, 0], [1.7, 2.7, 0.75, 0], [2.7, 9, 0.95, 5]]) {
          ctx.beginPath();
          for (const f of flakes) {
            if (f.s < lo || f.s >= hi) continue;
            ctx.moveTo(f.x + f.s, f.y);
            ctx.arc(f.x, f.y, f.s, 0, Math.PI * 2);
          }
          ctx.fillStyle = `rgba(255,255,255,${alpha})`;
          if (glow) { ctx.shadowColor = 'rgba(255,255,255,0.85)'; ctx.shadowBlur = glow; }
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      /* hail: hard white pellets, much faster than snow, short bright streaks down the wind */
      if (stones.length) {
        const slant = Math.min(0.35, (p.wind ?? 0) / 80) * towards;
        for (const s2 of stones) {
          s2.y += 760 * s2.v * dt * (contained ? 0.45 : 1);
          s2.x += 760 * s2.v * dt * slant * (contained ? 0.45 : 1);
          if (s2.y > H + 12) { s2.y = -12 - Math.random() * 40; s2.x = Math.random() * (W + 200) - 100; }
          if (s2.x > W + 30) s2.x -= W + 60;
          if (s2.x < -30) s2.x += W + 60;
        }
        ctx.strokeStyle = 'rgba(238,246,255,0.92)';
        ctx.lineCap = 'round';
        for (const [lo, hi, lw] of [[0, 2.4, 2], [2.4, 9, 3]]) {        // two sizes of stone
          ctx.lineWidth = lw;
          ctx.beginPath();
          for (const s2 of stones) {
            if (s2.w < lo || s2.w >= hi) continue;
            ctx.moveTo(s2.x, s2.y);
            ctx.lineTo(s2.x - s2.l * slant, s2.y - s2.l);
          }
          ctx.stroke();
        }
      }
      /* lightning: a double flicker every few seconds, sometimes with a visible bolt */
      if (p.group === 'storm' && !reduce) {
        flash.next -= dt;
        if (flash.next <= 0) {
          flash = { a: 0.55, next: 3 + Math.random() * 7, bolt: Math.random() < 0.55 ? makeBolt(W, H) : null, age: 0 };
        }
        if (flash.a > 0.01) {
          flash.age = (flash.age || 0) + dt;
          const flick = flash.age < 0.08 || (flash.age > 0.14 && flash.age < 0.22) ? 1 : 0.35;
          ctx.fillStyle = `rgba(225,232,255,${flash.a * flick * 0.6})`;
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
