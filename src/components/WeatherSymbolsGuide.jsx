/* ════════════════════════════════════════════════════════════════════════════
   Weather Symbols Guide.

   IT SHOWS THE REAL ICONS. It previously showed emoji, which meant the guide
   was not a guide to anything the site actually draws — a reader matching the
   page against a forecast would be comparing 🌧️ to a symbol they had never
   seen. Every row here renders the same component the forecast renders.

   THE "(DAY)" AND "(NIGHT)" LABELS WERE WRONG, and misleadingly so. In the Met
   Office scheme the paired codes are SHOWERS and the odd one out is CONTINUOUS:

     9, 10   light rain SHOWER (night, day)      12  light rain, continuous
     13, 14  heavy rain SHOWER                   15  heavy rain, continuous
     22, 23  light snow SHOWER                   24  light snow, continuous

   Labelling 9 as "Light Rain (Night)" reads as "the night-time version of light
   rain", which is not what it means: it means a shower — brief, scattered,
   bright spells in between. The label now leads with that and treats the time
   of day as the footnote it is.
   ════════════════════════════════════════════════════════════════════════════ */
import React from 'react';
import { motion } from 'framer-motion';
import { weatherIcons } from '@/components/WeatherIcons';

/* code -> what it means, plus the icon key. `spell` carries the shower vs
   continuous distinction; `when` is the time of day, which only exists because
   the Met Office encodes it in the code number. */
const SYMBOLS = [
  { code: 0,  name: 'Clear',          spell: '',            when: 'night', icon: 'Clear Night' },
  { code: 1,  name: 'Sunny',          spell: '',            when: 'day',   icon: 'Sunny' },
  { code: 2,  name: 'Partly cloudy',  spell: '',            when: 'night', icon: 'Partly Cloudy Night' },
  { code: 3,  name: 'Partly cloudy',  spell: '',            when: 'day',   icon: 'Partly Cloudy' },
  { code: 5,  name: 'Mist',           spell: '',            when: '',      icon: 'Mist' },
  { code: 6,  name: 'Fog',            spell: '',            when: '',      icon: 'Fog' },
  { code: 7,  name: 'Cloudy',         spell: '',            when: '',      icon: 'Cloudy' },
  { code: 8,  name: 'Overcast',       spell: '',            when: '',      icon: 'Overcast' },
  { code: 9,  name: 'Light rain',     spell: 'Showers',     when: 'night', icon: 'Rain Shower Night' },
  { code: 10, name: 'Light rain',     spell: 'Showers',     when: 'day',   icon: 'Rain Shower' },
  { code: 11, name: 'Drizzle',        spell: 'Continuous',  when: '',      icon: 'Drizzle' },
  { code: 12, name: 'Light rain',     spell: 'Continuous',  when: '',      icon: 'Light Rain' },
  { code: 13, name: 'Heavy rain',     spell: 'Showers',     when: 'night', icon: 'Heavy Showers Night' },
  { code: 14, name: 'Heavy rain',     spell: 'Showers',     when: 'day',   icon: 'Heavy Showers' },
  { code: 15, name: 'Heavy rain',     spell: 'Continuous',  when: '',      icon: 'Heavy Rain' },
  { code: 16, name: 'Sleet',          spell: 'Showers',     when: 'night', icon: 'Sleet Night' },
  { code: 17, name: 'Sleet',          spell: 'Showers',     when: 'day',   icon: 'Sleet' },
  { code: 18, name: 'Sleet',          spell: 'Continuous',  when: '',      icon: 'Sleet' },
  { code: 19, name: 'Hail',           spell: 'Showers',     when: 'night', icon: 'Hail Night' },
  { code: 20, name: 'Hail',           spell: 'Showers',     when: 'day',   icon: 'Hail' },
  { code: 21, name: 'Hail',           spell: 'Continuous',  when: '',      icon: 'Hail' },
  { code: 22, name: 'Light snow',     spell: 'Showers',     when: 'night', icon: 'Flurry Night' },
  { code: 23, name: 'Light snow',     spell: 'Showers',     when: 'day',   icon: 'Flurry' },
  { code: 24, name: 'Light snow',     spell: 'Continuous',  when: '',      icon: 'Light Snow' },
  { code: 25, name: 'Heavy snow',     spell: 'Showers',     when: 'night', icon: 'Heavy Snow Night' },
  { code: 26, name: 'Heavy snow',     spell: 'Showers',     when: 'day',   icon: 'Heavy Snow' },
  { code: 27, name: 'Heavy snow',     spell: 'Continuous',  when: '',      icon: 'Heavy Snow' },
  { code: 28, name: 'Thunder',        spell: 'Showers',     when: 'night', icon: 'Thundery Shower Night' },
  { code: 29, name: 'Thunder',        spell: 'Showers',     when: 'day',   icon: 'Thundery Shower' },
  { code: 30, name: 'Thunder',        spell: 'Continuous',  when: '',      icon: 'Thunderstorms' },
];

const CATEGORIES = [
  { name: 'Clear & Sunny',  codes: [0, 1, 2, 3],       tint: 'from-amber-500/15 to-yellow-500/5',  ring: 'border-amber-400/25',  dot: 'bg-amber-300' },
  { name: 'Cloud & Fog',    codes: [5, 6, 7, 8],       tint: 'from-slate-400/15 to-slate-500/5',   ring: 'border-slate-300/25',  dot: 'bg-slate-300' },
  { name: 'Rain',           codes: [9, 10, 11, 12, 13, 14, 15], tint: 'from-sky-500/15 to-blue-500/5', ring: 'border-sky-400/25', dot: 'bg-sky-300' },
  { name: 'Sleet & Hail',   codes: [16, 17, 18, 19, 20, 21],    tint: 'from-cyan-500/15 to-teal-500/5', ring: 'border-cyan-400/25', dot: 'bg-cyan-300' },
  { name: 'Snow',           codes: [22, 23, 24, 25, 26, 27],    tint: 'from-indigo-400/15 to-violet-500/5', ring: 'border-indigo-300/25', dot: 'bg-indigo-300' },
  { name: 'Thunder',        codes: [28, 29, 30],       tint: 'from-violet-500/15 to-fuchsia-500/5', ring: 'border-violet-400/25', dot: 'bg-violet-300' },
];

/** Small pill distinguishing a shower from continuous weather. */
function SpellTag({ spell }) {
  if (!spell) return null;
  const showery = spell === 'Showers';
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
      showery ? 'bg-amber-400/15 text-amber-200' : 'bg-sky-400/15 text-sky-200'}`}>
      {showery ? 'Showery' : 'Continuous'}
    </span>
  );
}

export default function WeatherSymbolsGuide() {
  return (
    <section className="max-w-6xl mx-auto px-4 py-12">
      <motion.div
        className="flex items-center gap-3 mb-3"
        initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }} transition={{ duration: 0.5 }}
      >
        <div className="p-2.5 rounded-xl bg-sky-500/15 backdrop-blur-sm">
          {React.createElement(weatherIcons['Sunny Intervals'], { size: 30 })}
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">Weather Symbols Guide</h2>
          <p className="text-slate-400 text-sm mt-0.5">The symbols used across MyWeather forecasts</p>
        </div>
      </motion.div>

      {/* The one thing readers get wrong, said once at the top rather than
          repeated on thirty rows. */}
      <p className="text-xs text-slate-400 mb-7 max-w-2xl leading-relaxed">
        <b className="text-amber-200">Showery</b> symbols show the sun or moon beside the cloud — the weather comes and
        goes, with brighter spells in between. <b className="text-sky-200">Continuous</b> symbols show cloud only, meaning
        it stays that way for the whole period. The difference is coverage, not the time of day.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {CATEGORIES.map((cat, ci) => (
          <motion.div
            key={cat.name}
            initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ delay: ci * 0.06, duration: 0.5 }}
            className={`rounded-2xl border ${cat.ring} bg-gradient-to-br ${cat.tint} backdrop-blur-sm p-5`}
          >
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-2.5 h-2.5 rounded-full ${cat.dot}`} />
              <h3 className="text-sm font-semibold text-white uppercase tracking-wide">{cat.name}</h3>
            </div>
            <div className="space-y-1">
              {cat.codes.map((code) => {
                const s = SYMBOLS.find(x => x.code === code);
                const Icon = weatherIcons[s.icon];
                return (
                  <div key={code} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-white/5 transition-colors">
                    <span className="w-9 h-9 shrink-0 flex items-center justify-center">
                      {Icon ? <Icon size={34} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-slate-100 truncate">
                        {s.name}{s.when ? <span className="text-slate-400"> · {s.when}</span> : null}
                      </span>
                      <SpellTag spell={s.spell} />
                    </span>
                    <span className="text-xs text-slate-500 font-mono shrink-0">#{code}</span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
        transition={{ delay: 0.4 }}
        className="text-center text-xs text-slate-500 mt-6"
      >
        Codes follow the Met Office significant weather classification
      </motion.p>
    </section>
  );
}
