import React from 'react';
import { motion } from 'framer-motion';
import { Leaf, AlertCircle } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';

function getAQIColor(aqi) {
  if (aqi <= 50) return { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Good', risk: 'Low' };
  if (aqi <= 100) return { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Moderate', risk: 'Moderate' };
  if (aqi <= 150) return { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Unhealthy for Sensitive Groups', risk: 'Elevated' };
  if (aqi <= 200) return { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Unhealthy', risk: 'High' };
  if (aqi <= 300) return { bg: 'bg-purple-500/20', text: 'text-purple-400', label: 'Very Unhealthy', risk: 'Very High' };
  return { bg: 'bg-pink-500/20', text: 'text-pink-400', label: 'Hazardous', risk: 'Hazardous' };
}

function getPollutantInfo(pollutant, value) {
  const info = {
    'PM2.5': { unit: 'µg/m³', safe: 12, threshold: 35 },
    'PM10': { unit: 'µg/m³', safe: 54, threshold: 154 },
    'O3': { unit: 'ppb', safe: 55, threshold: 70 },
    'NO2': { unit: 'ppb', safe: 53, threshold: 100 },
    'SO2': { unit: 'ppb', safe: 35, threshold: 75 },
    'CO': { unit: 'ppm', safe: 4.4, threshold: 9.4 },
  };

  const data = info[pollutant];
  if (!data) return null;

  const status = value <= data.safe ? 'Good' : value <= data.threshold ? 'Moderate' : 'High';
  const statusColor = value <= data.safe ? 'text-green-400' : value <= data.threshold ? 'text-yellow-400' : 'text-red-400';

  return { ...data, status, statusColor };
}

export default function AQIDisplay({ aqi = null, pollutants = {} }) {
  const { isDark } = useTheme();

  if (!aqi && !pollutants) {
    return null;
  }

  const aqiInfo = aqi ? getAQIColor(aqi) : null;

  return (
    <div className="space-y-4">
      {aqi !== null && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-2xl p-5 border ${
            isDark ? `${aqiInfo.bg} border-slate-700/50` : 'bg-slate-100 border-slate-300'
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className={`p-2.5 rounded-lg ${aqiInfo.bg}`}>
                <Leaf className={`w-5 h-5 ${aqiInfo.text}`} />
              </div>
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Air Quality Index
                </p>
                <div className="mt-2">
                  <p className={`text-3xl font-bold ${aqiInfo.text}`}>{Math.round(aqi)}</p>
                  <p className={`text-sm mt-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {aqiInfo.label}
                  </p>
                </div>
              </div>
            </div>
            <div className={`text-right p-3 rounded-lg ${
              isDark ? 'bg-slate-700/30' : 'bg-slate-200'
            }`}>
              <p className={`text-xs font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Health Risk
              </p>
              <p className={`text-sm font-bold mt-1 ${aqiInfo.text}`}>
                {aqiInfo.risk}
              </p>
            </div>
          </div>

          {/* AQI Scale */}
          <div className="mt-4 space-y-2">
            <p className={`text-xs font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Scale</p>
            <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-slate-700/20">
              <div className="flex-1 bg-green-500" title="Good (0-50)" />
              <div className="flex-1 bg-yellow-500" title="Moderate (51-100)" />
              <div className="flex-1 bg-orange-500" title="Unhealthy for Sensitive (101-150)" />
              <div className="flex-1 bg-red-500" title="Unhealthy (151-200)" />
              <div className="flex-1 bg-purple-500" title="Very Unhealthy (201-300)" />
              <div className="flex-1 bg-pink-500" title="Hazardous (301+)" />
            </div>
          </div>
        </motion.div>
      )}

      {/* Pollutants Detail */}
      {Object.keys(pollutants).length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className={`rounded-xl p-4 border ${
            isDark ? 'bg-slate-800/50 border-slate-700/50' : 'bg-white border-slate-300'
          }`}
        >
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className={`w-4 h-4 ${isDark ? 'text-slate-400' : 'text-slate-600'}`} />
            <p className={`text-sm font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
              Key Pollutants
            </p>
          </div>
          <div className="space-y-3">
            {Object.entries(pollutants).map(([name, value]) => {
              const info = getPollutantInfo(name, value);
              if (!info) return null;
              return (
                <motion.div
                  key={name}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={`flex items-center justify-between p-2.5 rounded-lg ${
                    isDark ? 'bg-slate-700/30' : 'bg-slate-100'
                  }`}
                >
                  <div>
                    <p className={`text-sm font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      {name}
                    </p>
                    <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                      {value.toFixed(1)} {info.unit}
                    </p>
                  </div>
                  <span className={`text-xs font-bold ${info.statusColor}`}>
                    {info.status}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
}