import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import WeatherScene from '@/components/weather/WeatherScene';
import WeatherParticles from '@/components/weather/WeatherParticles';
import { SKY_CONFIGS } from '@/components/weather/skyConfigs';

// ─── All sky gradient configs, matching WeatherAtmosphere SKY_CONFIGS ──────
/* SKY_CONFIGS moved to weather/skyConfigs.js so the Location Forecast page
   renders the same sky this library previews. */

const SOUND_LABELS = {
  null: '—',
  drizzle: '🌧 Drizzle',
  rain: '🌧 Rain',
  torrential: '🌧 Heavy Rain',
  snow: '❄️ Snow',
  heavySnow: '❄️ Heavy Snow',
  blizzard: '🌨 Blizzard',
  sleet: '🌨 Sleet',
  hail: '🌩 Hail',
  fog: '🌫 Mist',
  wind: '💨 Wind',
  lightning: '⚡ Thunder',
};

const PHASES = ['day', 'sunrise', 'sunset', 'night'];
const PHASE_LABELS = { day: 'Day', sunrise: 'Sunrise', sunset: 'Sunset', night: 'Night' };

const CATEGORIES = [
  { label: 'Clear & Sunny', keys: ['Sunny', 'Clear Night', 'Sunny Intervals', 'Sunny Intervals Night', 'Partly Cloudy', 'Partly Cloudy Night'] },
  { label: 'Cloud & Atmosphere', keys: ['Cloudy', 'Overcast', 'Mist', 'Fog', 'Windy'] },
  { label: 'Rain — Day', keys: ['Drizzle', 'Light Rain', 'Moderate Rain', 'Heavy Rain', 'Torrential Rain', 'Rain Shower', 'Heavy Showers'] },
  { label: 'Rain — Night', keys: ['Drizzle Night', 'Light Rain Night', 'Moderate Rain Night', 'Heavy Rain Night', 'Torrential Rain Night', 'Rain Shower Night', 'Heavy Showers Night'] },
  { label: 'Rain — Cloud', keys: ['Rain Shower Cloud', 'Heavy Showers Cloud'] },
  { label: 'Snow — Day', keys: ['Flurry', 'Light Snow', 'Snow', 'Heavy Snow', 'Blizzard'] },
  { label: 'Snow — Night', keys: ['Flurry Night', 'Light Snow Night', 'Snow Night', 'Heavy Snow Night', 'Blizzard Night'] },
  { label: 'Snow — Cloud', keys: ['Flurry Cloud', 'Light Snow Cloud', 'Snow Cloud', 'Heavy Snow Cloud', 'Blizzard Cloud'] },
  { label: 'Sleet — Day', keys: ['Light Sleet', 'Sleet', 'Heavy Sleet'] },
  { label: 'Sleet — Night', keys: ['Light Sleet Night', 'Sleet Night', 'Heavy Sleet Night'] },
  { label: 'Sleet — Cloud', keys: ['Light Sleet Cloud', 'Sleet Cloud', 'Heavy Sleet Cloud'] },
  { label: 'Hail — Day', keys: ['Light Hail', 'Hail', 'Heavy Hail'] },
  { label: 'Hail — Night', keys: ['Light Hail Night', 'Hail Night', 'Heavy Hail Night'] },
  { label: 'Hail — Cloud', keys: ['Light Hail Cloud', 'Hail Cloud', 'Heavy Hail Cloud'] },
  { label: 'Thunderstorms', keys: ['Thundery Shower', 'Thundery Shower Night', 'Thundery Shower Cloud', 'Isolated Thunderstorms', 'Scattered Thunderstorms', 'Thunderstorms'] },
];

/* The old useLightning hook lived here: a timer that toggled a flat white
   overlay on and off every few seconds. It has been removed rather than left
   dormant — WeatherScene now strikes an actual branched bolt and lights the sky
   around it on a double-flash timing, driven by CSS rather than by a React
   state update per tile. Sixty-six independent timers each re-rendering a
   component was also the single most expensive thing on this page. */

function AnimatedSwatch({ name, gradient, phase, cfg, playSound }) {
  const audioCtxRef = useRef(null);

  // Sound preview on click
  const handleSoundPreview = (e) => {
    e.stopPropagation();
    if (!playSound || !cfg) return;
    try {
      if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} }
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const bufferSize = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = false;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      const pType = cfg.particles;
      filter.frequency.value = pType === 'blizzard' || pType === 'wind' ? 280 : pType === 'snow' || pType === 'heavySnow' ? 320 : pType === 'torrential' ? 700 : pType === 'rain' ? 1400 : pType === 'drizzle' ? 2200 : pType === 'hail' ? 1800 : pType === 'sleet' ? 1500 : pType === 'fog' ? 600 : 1000;
      filter.Q.value = 1;
      const gain = ctx.createGain();
      const intensity = pType === 'torrential' ? 0.5 : pType === 'blizzard' ? 0.3 : pType === 'heavySnow' ? 0.15 : 0.2;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(intensity, ctx.currentTime + 0.1);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start();
      src.stop(ctx.currentTime + 2);
      if (cfg.lightning) {
        setTimeout(() => {
          if (ctx.state === 'closed') return;
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.frequency.value = 50;
          osc.type = 'sawtooth';
          g.gain.setValueAtTime(0.4, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
          osc.connect(g);
          g.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 1.2);
        }, 500 + Math.random() * 800);
      }
    } catch {}
  };

  /* The particle loop moved to weather/WeatherParticles.jsx — same reason as
     SKY_CONFIGS: the forecast page needs the identical rain. */

  const soundType = cfg?.particles;
  const hasSound = !!soundType;

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="relative w-full h-20 rounded-lg border border-white/10 shadow-inner overflow-hidden"
        title={`${name} — ${PHASE_LABELS[phase]}`}
      >
        {/* The gradient is now the BACK of a drawn scene rather than the whole
            picture: WeatherScene puts the sun, moon, cloud banks, bolts and fog
            in front of it. The particle canvas still sits on top, because rain
            and snow genuinely are particles and the canvas does that better
            than anything declarative. */}
        <WeatherScene name={name} gradient={gradient} phase={phase} />
        {cfg?.particles && (
          <WeatherParticles type={cfg.particles} count={cfg.count} speed={cfg.speed} />
        )}
        {/* The old flat white overlay is gone — WeatherScene strikes a branched
            bolt and lights the sky around it on a realistic double-flash
            timing, which is what `lightning` was standing in for. */}
        {hasSound && (
          <button
            onClick={handleSoundPreview}
            className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-black/40 border border-white/20 flex items-center justify-center text-white/70 hover:text-white hover:bg-black/60 transition-colors text-[10px]"
            title="Preview sound"
          >
            ♪
          </button>
        )}
      </div>
      <span className="text-[10px] text-slate-400">{PHASE_LABELS[phase]}</span>
    </div>
  );
}

export default function WeatherBackgroundsLibrary() {
  const [activePhase, setActivePhase] = useState('all');
  const [soundEnabled, setSoundEnabled] = useState(true);

  const phasesToShow = activePhase === 'all' ? PHASES : [activePhase];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Weather Backgrounds Library</h2>
          <p className="text-slate-500 text-sm mt-1">All sky gradients with animations. Click ♪ on any swatch to preview its sound.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSoundEnabled(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${soundEnabled ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-600'}`}
          >
            {soundEnabled ? '🔊' : '🔇'} Sound Preview
          </button>
          {['all', ...PHASES].map(p => (
            <button
              key={p}
              onClick={() => setActivePhase(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activePhase === p ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {p === 'all' ? 'All' : PHASE_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {CATEGORIES.map(cat => (
        <motion.div
          key={cat.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900 rounded-2xl p-5 space-y-4"
        >
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">{cat.label}</h3>
          <div className="space-y-4">
            {cat.keys.map(conditionName => {
              const cfg = SKY_CONFIGS[conditionName];
              if (!cfg) return null;
              return (
                <div key={conditionName} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-slate-400">{conditionName}</p>
                    {cfg.particles && <span className="text-[10px] text-slate-500">{SOUND_LABELS[cfg.particles] || cfg.particles}{cfg.lightning ? ' + ⚡' : ''}</span>}
                  </div>
                  <div className={`grid gap-2 ${phasesToShow.length === 4 ? 'grid-cols-4' : phasesToShow.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {phasesToShow.map(phase => (
                      <AnimatedSwatch
                        key={phase}
                        name={conditionName}
                        gradient={cfg[phase] || cfg.day}
                        phase={phase}
                        cfg={cfg}
                        playSound={soundEnabled}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      ))}
    </div>
  );
}