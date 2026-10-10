import React from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '@/components/ThemeContext';
import { weatherIcons } from '@/components/WeatherIcons';

const CATEGORIES = [
  {
    name: 'Clear & Sunny',
    icons: [
      ['Sunny', 'Sunny'],
      ['Clear Night', 'Clear Night'],
      ['Sunny Intervals', 'Sunny Intervals'],
      ['Sunny Intervals Night', 'S. Intervals Night'],
      ['Sunny Intervals V2', 'S. Intervals V2'],
      ['Partly Cloudy', 'Partly Cloudy'],
      ['Partly Cloudy Night', 'Partly Cloudy Night'],
    ],
  },
  {
    name: 'Cloud & Atmosphere',
    icons: [
      ['Cloudy', 'Cloudy'],
      ['Overcast', 'Overcast'],
      ['Fog', 'Fog'],
      ['Mist', 'Mist'],
      ['Windy', 'Windy'],
    ],
  },
  {
    name: 'Rain — Day',
    icons: [
      ['Drizzle', 'Drizzle'],
      ['Light Rain', 'Light Rain'],
      ['Moderate Rain', 'Moderate Rain'],
      ['Heavy Rain', 'Heavy Rain'],
      ['Torrential Rain', 'Torrential'],
      ['Rain Shower', 'Shower'],
      ['Moderate Shower', 'Mod. Shower'],
      ['Heavy Showers', 'Heavy Shower'],
      ['Thundery Shower', 'Thundery Shower'],
    ],
  },
  {
    name: 'Rain — Night',
    icons: [
      ['Drizzle Night', 'Drizzle'],
      ['Light Rain Night', 'Light Rain'],
      ['Moderate Rain Night', 'Moderate Rain'],
      ['Heavy Rain Night', 'Heavy Rain'],
      ['Torrential Rain Night', 'Torrential'],
      ['Rain Shower Night', 'Shower'],
      ['Moderate Shower Night', 'Mod. Shower'],
      ['Heavy Showers Night', 'Heavy Shower'],
      ['Thundery Shower Night', 'Thundery Shower'],
    ],
  },
  {
    name: 'Rain — Cloud Only',
    icons: [
      ['Drizzle Cloud', 'Drizzle'],
      ['Light Rain Cloud', 'Light Rain'],
      ['Moderate Rain Cloud', 'Moderate Rain'],
      ['Heavy Rain Cloud', 'Heavy Rain'],
      ['Torrential Rain Cloud', 'Torrential'],
      ['Rain Shower Cloud', 'Shower'],
      ['Moderate Shower Cloud', 'Mod. Shower'],
      ['Heavy Showers Cloud', 'Heavy Shower'],
      ['Thundery Shower Cloud', 'Thundery Shower'],
    ],
  },
  {
    name: 'Snow — Day',
    icons: [
      ['Flurry', 'Flurry'],
      ['Light Snow', 'Light Snow'],
      ['Snow', 'Snow'],
      ['Heavy Snow', 'Heavy Snow'],
      ['Blizzard', 'Blizzard'],
    ],
  },
  {
    name: 'Snow — Night',
    icons: [
      ['Flurry Night', 'Flurry'],
      ['Light Snow Night', 'Light Snow'],
      ['Snow Night', 'Snow'],
      ['Heavy Snow Night', 'Heavy Snow'],
      ['Blizzard Night', 'Blizzard'],
    ],
  },
  {
    name: 'Snow — Cloud Only',
    icons: [
      ['Flurry Cloud', 'Flurry'],
      ['Light Snow Cloud', 'Light Snow'],
      ['Snow Cloud', 'Snow'],
      ['Heavy Snow Cloud', 'Heavy Snow'],
      ['Blizzard Cloud', 'Blizzard'],
    ],
  },
  {
    name: 'Sleet & Hail — Day',
    icons: [
      ['Light Sleet', 'Light Sleet'],
      ['Sleet', 'Sleet'],
      ['Heavy Sleet', 'Heavy Sleet'],
      ['Light Hail', 'Light Hail'],
      ['Hail', 'Hail'],
      ['Heavy Hail', 'Heavy Hail'],
    ],
  },
  {
    name: 'Sleet & Hail — Night',
    icons: [
      ['Light Sleet Night', 'Light Sleet'],
      ['Sleet Night', 'Sleet'],
      ['Heavy Sleet Night', 'Heavy Sleet'],
      ['Light Hail Night', 'Light Hail'],
      ['Hail Night', 'Hail'],
      ['Heavy Hail Night', 'Heavy Hail'],
    ],
  },
  {
    name: 'Sleet & Hail — Cloud Only',
    icons: [
      ['Light Sleet Cloud', 'Light Sleet'],
      ['Sleet Cloud', 'Sleet'],
      ['Heavy Sleet Cloud', 'Heavy Sleet'],
      ['Light Hail Cloud', 'Light Hail'],
      ['Hail Cloud', 'Hail'],
      ['Heavy Hail Cloud', 'Heavy Hail'],
    ],
  },
  {
    name: 'Thunderstorms',
    icons: [
      ['Isolated Thunderstorms', 'Isolated'],
      ['Scattered Thunderstorms', 'Scattered'],
      ['Thunder', 'Thunderstorms'],
    ],
  },
];

export default function WeatherSymbolsLibrary() {
  const { isDark } = useTheme();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className={`rounded-3xl p-6 md:p-8 border transition-colors ${isDark ? 'bg-slate-800/50 border-slate-700/50' : 'bg-white border-slate-200'}`}
    >
      <h3 className={`text-xl font-bold mb-6 ${isDark ? 'text-white' : 'text-slate-900'}`}>
        Weather Symbols Guide
      </h3>

      <div className="space-y-7">
        {CATEGORIES.map((cat, ci) => (
          <motion.div
            key={cat.name}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: ci * 0.04 }}
          >
            <p className={`text-xs font-semibold uppercase tracking-widest mb-3 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              {cat.name}
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-9 gap-3">
              {cat.icons.map(([key, label]) => {
                const Icon = weatherIcons[key];
                if (!Icon) return null;
                return (
                  <motion.div
                    key={key}
                    whileHover={{ y: -3, scale: 1.06 }}
                    transition={{ duration: 0.18 }}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl cursor-pointer transition-all ${
                      isDark
                        ? 'bg-slate-700/40 hover:bg-slate-700/70 border border-slate-600/30 hover:border-sky-500/40'
                        : 'bg-slate-50 hover:bg-slate-100 border border-slate-200/80 hover:border-sky-400/60'
                    }`}
                  >
                    <Icon size={40} />
                    <span className={`text-[10px] font-medium text-center leading-tight ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                      {label}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}