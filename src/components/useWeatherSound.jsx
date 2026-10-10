import { useEffect, useRef } from 'react';

// ─── SOUND CONFIGS ────────────────────────────────────────────────────────────
// type: 'rain' | 'thunder' | 'wind' | 'hail'
// Multiple filter layers for realism
const SOUND_CONFIGS = {
  'Drizzle':               { type: 'rain', gain: 0.06,  lo: 1800, hi: 4000, loQ: 0.7, hiQ: 0.5 },
  'Drizzle Night':         { type: 'rain', gain: 0.06,  lo: 1800, hi: 4000, loQ: 0.7, hiQ: 0.5 },
  'Light Rain':            { type: 'rain', gain: 0.13,  lo: 1200, hi: 3500, loQ: 0.8, hiQ: 0.6 },
  'Light Rain Night':      { type: 'rain', gain: 0.13,  lo: 1200, hi: 3500, loQ: 0.8, hiQ: 0.6 },
  'Moderate Rain':         { type: 'rain', gain: 0.22,  lo:  900, hi: 2800, loQ: 0.9, hiQ: 0.7 },
  'Moderate Rain Night':   { type: 'rain', gain: 0.22,  lo:  900, hi: 2800, loQ: 0.9, hiQ: 0.7 },
  'Heavy Rain':            { type: 'rain', gain: 0.38,  lo:  600, hi: 2000, loQ: 1.0, hiQ: 0.8 },
  'Heavy Rain Night':      { type: 'rain', gain: 0.38,  lo:  600, hi: 2000, loQ: 1.0, hiQ: 0.8 },
  'Torrential Rain':       { type: 'rain', gain: 0.6,   lo:  350, hi: 1400, loQ: 1.2, hiQ: 1.0, rumble: true },
  'Torrential Rain Night': { type: 'rain', gain: 0.6,   lo:  350, hi: 1400, loQ: 1.2, hiQ: 1.0, rumble: true },
  'Rain Shower':           { type: 'rain', gain: 0.18,  lo: 1100, hi: 3200, loQ: 0.85, hiQ: 0.65 },
  'Rain Shower Night':     { type: 'rain', gain: 0.18,  lo: 1100, hi: 3200, loQ: 0.85, hiQ: 0.65 },
  'Rain Shower Cloud':     { type: 'rain', gain: 0.18,  lo: 1100, hi: 3200, loQ: 0.85, hiQ: 0.65 },
  'Heavy Showers':         { type: 'rain', gain: 0.48,  lo:  500, hi: 1800, loQ: 1.1, hiQ: 0.9 },
  'Heavy Showers Night':   { type: 'rain', gain: 0.48,  lo:  500, hi: 1800, loQ: 1.1, hiQ: 0.9 },
  'Heavy Showers Cloud':   { type: 'rain', gain: 0.48,  lo:  500, hi: 1800, loQ: 1.1, hiQ: 0.9 },
  // Sleet – mix of rain + ice tick
  'Light Sleet':           { type: 'rain', gain: 0.14,  lo: 1400, hi: 3800, loQ: 0.8, hiQ: 0.6, iceTick: true, iceRate: 300 },
  'Light Sleet Night':     { type: 'rain', gain: 0.14,  lo: 1400, hi: 3800, loQ: 0.8, hiQ: 0.6, iceTick: true, iceRate: 300 },
  'Sleet':                 { type: 'rain', gain: 0.22,  lo: 1100, hi: 3000, loQ: 0.9, hiQ: 0.7, iceTick: true, iceRate: 180 },
  'Sleet Night':           { type: 'rain', gain: 0.22,  lo: 1100, hi: 3000, loQ: 0.9, hiQ: 0.7, iceTick: true, iceRate: 180 },
  'Heavy Sleet':           { type: 'rain', gain: 0.38,  lo:  700, hi: 2200, loQ: 1.0, hiQ: 0.8, iceTick: true, iceRate: 80 },
  'Heavy Sleet Night':     { type: 'rain', gain: 0.38,  lo:  700, hi: 2200, loQ: 1.0, hiQ: 0.8, iceTick: true, iceRate: 80 },
  // Thunder
  'Thundery Shower':         { type: 'thunder', rain: { gain: 0.22, lo: 900,  hi: 2800, loQ: 0.9, hiQ: 0.7 }, thunderRate: [8000, 14000] },
  'Thundery Shower Night':   { type: 'thunder', rain: { gain: 0.22, lo: 900,  hi: 2800, loQ: 0.9, hiQ: 0.7 }, thunderRate: [8000, 14000] },
  'Thundery Shower Cloud':   { type: 'thunder', rain: { gain: 0.22, lo: 900,  hi: 2800, loQ: 0.9, hiQ: 0.7 }, thunderRate: [8000, 14000] },
  'Isolated Thunderstorms':  { type: 'thunder', rain: { gain: 0.38, lo: 600,  hi: 2000, loQ: 1.0, hiQ: 0.8 }, thunderRate: [5000, 10000] },
  'Scattered Thunderstorms': { type: 'thunder', rain: { gain: 0.52, lo: 450,  hi: 1600, loQ: 1.1, hiQ: 0.9 }, thunderRate: [3500, 8000] },
  'Thunderstorms':           { type: 'thunder', rain: { gain: 0.65, lo: 300,  hi: 1200, loQ: 1.3, hiQ: 1.1 }, thunderRate: [2000, 6000], rumble: true },
  // Snow / wind
  'Flurry':          { type: 'wind', gain: 0.04, freq: 380, q: 0.45 },
  'Flurry Night':    { type: 'wind', gain: 0.04, freq: 380, q: 0.45 },
  'Light Snow':      { type: 'wind', gain: 0.05, freq: 320, q: 0.38 },
  'Light Snow Night':{ type: 'wind', gain: 0.05, freq: 320, q: 0.38 },
  'Snow':            { type: 'wind', gain: 0.07, freq: 290, q: 0.38 },
  'Snow Night':      { type: 'wind', gain: 0.07, freq: 290, q: 0.38 },
  'Heavy Snow':      { type: 'wind', gain: 0.11, freq: 250, q: 0.45 },
  'Heavy Snow Night':{ type: 'wind', gain: 0.11, freq: 250, q: 0.45 },
  'Blizzard':        { type: 'wind', gain: 0.32, freq: 200, q: 0.8, howl: true },
  'Blizzard Night':  { type: 'wind', gain: 0.32, freq: 200, q: 0.8, howl: true },
  // Hail
  'Light Hail':      { type: 'hail', gain: 0.12, freq: 2200, rate: 280 },
  'Light Hail Night':{ type: 'hail', gain: 0.12, freq: 2200, rate: 280 },
  'Hail':            { type: 'hail', gain: 0.28, freq: 1900, rate: 120 },
  'Hail Night':      { type: 'hail', gain: 0.28, freq: 1900, rate: 120 },
  'Heavy Hail':      { type: 'hail', gain: 0.5,  freq: 1600, rate: 50 },
  'Heavy Hail Night':{ type: 'hail', gain: 0.5,  freq: 1600, rate: 50 },
  // Atmosphere
  'Windy': { type: 'wind', gain: 0.14, freq: 260, q: 0.65, howl: true },
  'Fog':   { type: 'wind', gain: 0.025, freq: 550, q: 0.3 },
  'Mist':  { type: 'wind', gain: 0.025, freq: 550, q: 0.3 },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function makeNoise(ctx, seconds = 3) {
  const n = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}

// Layered rain: pink-noise-ish via 2 band-pass filters
function startRain(ctx, cfg, master) {
  const buf = makeNoise(ctx, 4);

  const lo = ctx.createBiquadFilter();
  lo.type = 'bandpass';
  lo.frequency.value = cfg.lo;
  lo.Q.value = cfg.loQ;

  const hi = ctx.createBiquadFilter();
  hi.type = 'bandpass';
  hi.frequency.value = cfg.hi;
  hi.Q.value = cfg.hiQ;

  const hiGain = ctx.createGain();
  hiGain.gain.value = 0.45; // hi shelf slightly quieter

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  // slow gain LFO for "waviness" of rain intensity
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.07 + Math.random() * 0.08;
  lfoGain.gain.value = cfg.gain * 0.12;
  lfo.connect(lfoGain);
  lfoGain.connect(master.gain);
  lfo.start();

  src.connect(lo);
  src.connect(hi);
  lo.connect(master);
  hi.connect(hiGain);
  hiGain.connect(master);
  src.start();

  return { src, lo, hi, lfo };
}

// Realistic rolling thunder: noise burst shaped into boom + rumble
function playThunder(ctx) {
  const now = ctx.currentTime;
  const buf = makeNoise(ctx, 3);

  const src = ctx.createBufferSource();
  src.buffer = buf;

  // Low rumble filter
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 180 + Math.random() * 80;

  // Distant crack – a short mid burst
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 300 + Math.random() * 200;
  bp.Q.value = 0.5;

  const gBoom = ctx.createGain();
  const gRumble = ctx.createGain();

  // Crack envelope
  gBoom.gain.setValueAtTime(0, now);
  gBoom.gain.linearRampToValueAtTime(0.55 + Math.random() * 0.25, now + 0.02);
  gBoom.gain.exponentialRampToValueAtTime(0.001, now + 0.45 + Math.random() * 0.3);

  // Rumble fades slower
  gRumble.gain.setValueAtTime(0, now);
  gRumble.gain.linearRampToValueAtTime(0.22 + Math.random() * 0.12, now + 0.12);
  gRumble.gain.exponentialRampToValueAtTime(0.001, now + 2.2 + Math.random() * 1.5);

  src.connect(bp); bp.connect(gBoom); gBoom.connect(ctx.destination);
  src.connect(lp); lp.connect(gRumble); gRumble.connect(ctx.destination);
  src.start(now);
  src.stop(now + 4);
}

function scheduleThunder(ctx, rateLo, rateHi, stoppedRef) {
  const delay = rateLo + Math.random() * (rateHi - rateLo);
  const t = setTimeout(() => {
    if (stoppedRef.current || ctx.state === 'closed') return;
    playThunder(ctx);
    scheduleThunder(ctx, rateLo, rateHi, stoppedRef);
  }, delay);
  return t;
}

// Continuous background rumble for torrential / full storm
function startRumble(ctx, master) {
  const buf = makeNoise(ctx, 2);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 90;

  const g = ctx.createGain();
  g.gain.value = 0.06;

  src.connect(lp); lp.connect(g); g.connect(ctx.destination);
  src.start();
  return src;
}

// Wind: layered noise through low-pass, with optional howl oscillator
function startWind(ctx, cfg, master) {
  const buf = makeNoise(ctx, 4);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cfg.freq;
  lp.Q.value = cfg.q;

  src.connect(lp);
  lp.connect(master);
  src.start();

  let howlOsc = null;
  if (cfg.howl) {
    // Slow howl oscillator that modulates pitch
    howlOsc = ctx.createOscillator();
    const howlGain = ctx.createGain();
    howlOsc.type = 'sine';
    howlOsc.frequency.value = 80 + Math.random() * 40;

    // frequency modulation via LFO
    const lfoOsc = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfoOsc.frequency.value = 0.15 + Math.random() * 0.1;
    lfoGain.gain.value = 30;
    lfoOsc.connect(lfoGain);
    lfoGain.connect(howlOsc.frequency);

    howlGain.gain.value = cfg.gain * 0.18;
    howlOsc.connect(howlGain);
    howlGain.connect(ctx.destination);
    howlOsc.start();
    lfoOsc.start();

    return { src, lp, howlOsc, lfoOsc };
  }

  return { src, lp };
}

// Hail: random sharp clicks
function startHail(ctx, cfg, master, stoppedRef) {
  function pop() {
    if (stoppedRef.current || ctx.state === 'closed') return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    osc.type = 'triangle';
    osc.frequency.value = cfg.freq + Math.random() * 600;
    g.gain.setValueAtTime(cfg.gain * 0.7, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.025 + Math.random() * 0.02);
    osc.connect(hp); hp.connect(g); g.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.06);
    const next = cfg.rate * 0.5 + Math.random() * cfg.rate;
    setTimeout(pop, next);
  }
  pop();
}

// Ice tick (sleet: occasional metallic high tick on top of rain)
function startIceTick(ctx, rate, stoppedRef) {
  function tick() {
    if (stoppedRef.current || ctx.state === 'closed') return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 2800 + Math.random() * 1200;
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.015);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.02);
    setTimeout(tick, rate * 0.6 + Math.random() * rate * 0.8);
  }
  tick();
}

// ─── HOOK ─────────────────────────────────────────────────────────────────────
export default function useWeatherSound(condition, enabled) {
  const cleanupRef = useRef(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !condition) return;

    const cfg = SOUND_CONFIGS[condition];
    if (!cfg) return;

    stoppedRef.current = false;

    let ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { return; }

    const master = ctx.createGain();
    master.gain.value = cfg.type === 'rain' ? cfg.gain : cfg.type === 'wind' ? cfg.gain : 1;
    master.connect(ctx.destination);

    const handles = [];

    if (cfg.type === 'rain') {
      handles.push(startRain(ctx, cfg, master));
      if (cfg.rumble) handles.push(startRumble(ctx, master));
      if (cfg.iceTick) startIceTick(ctx, cfg.iceRate, stoppedRef);
    }

    if (cfg.type === 'thunder') {
      const r = cfg.rain;
      const rainMaster = ctx.createGain();
      rainMaster.gain.value = r.gain;
      rainMaster.connect(ctx.destination);
      handles.push(startRain(ctx, r, rainMaster));
      if (cfg.rumble) handles.push(startRumble(ctx, rainMaster));
      const [lo, hi] = cfg.thunderRate;
      const tRef = scheduleThunder(ctx, lo, hi, stoppedRef);
      handles.push({ _thunderTimeout: tRef });
    }

    if (cfg.type === 'wind') {
      handles.push(startWind(ctx, cfg, master));
    }

    if (cfg.type === 'hail') {
      startHail(ctx, cfg, master, stoppedRef);
    }

    cleanupRef.current = () => {
      stoppedRef.current = true;
      handles.forEach(h => {
        if (h?._thunderTimeout) clearTimeout(h._thunderTimeout);
        try { h?.src?.stop(); } catch {}
        try { h?.lfo?.stop(); } catch {}
        try { h?.howlOsc?.stop(); } catch {}
        try { h?.lfoOsc?.stop(); } catch {}
      });
      try { ctx.close(); } catch {}
    };

    return cleanupRef.current;
  }, [condition, enabled]);
}