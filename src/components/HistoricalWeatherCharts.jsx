import React from 'react';
import { motion } from 'framer-motion';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Thermometer, Droplets, Wind } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import { useUnits } from '@/components/useUnits';

export default function HistoricalWeatherCharts({ forecast = [] }) {
  const { isDark } = useTheme();
  const { fmtTemp, fmtWind, tempUnit, windUnit } = useUnits();

  if (!forecast || forecast.length === 0) {
    return null;
  }

  // Prepare data for charts
  const chartData = forecast.slice(0, 5).map(day => ({
    date: day.date?.slice(5).replace('-', '/') || 'N/A',
    tempHigh: day.temperature?.max || 0,
    tempLow: day.temperature?.min || 0,
    tempAvg: Math.round((day.temperature?.max + day.temperature?.min) / 2 || 0),
    precipitation: day.precipitation || 0,
    windSpeed: day.windSpeed || 0,
    rainChance: day.rainChance || 0,
  }));

  const chartConfig = {
    grid: isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(71, 85, 105, 0.1)',
    text: isDark ? '#cbd5e1' : '#334155',
    tooltip: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
  };

  return (
    <div className="space-y-6">
      <h3 className={`text-lg font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-slate-800'}`}>
        <Thermometer className="w-5 h-5 text-orange-400" />
        5-Day Weather Overview
      </h3>

      {/* Temperature Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-xl p-4 border ${
          isDark ? 'bg-slate-800/50 border-slate-700/50' : 'bg-white border-slate-300'
        }`}
      >
        <div className="flex items-center gap-2 mb-4">
          <Thermometer className="w-4 h-4 text-orange-400" />
          <p className={`text-sm font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            Temperature Trend
          </p>
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartConfig.grid} />
            <XAxis dataKey="date" stroke={chartConfig.text} style={{ fontSize: '12px' }} />
            <YAxis stroke={chartConfig.text} style={{ fontSize: '12px' }} />
            <Tooltip
              contentStyle={{
                backgroundColor: chartConfig.tooltip,
                border: `1px solid ${isDark ? '#475569' : '#cbd5e1'}`,
                borderRadius: '8px',
                color: chartConfig.text,
              }}
              formatter={(value) => fmtTemp(value)}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="tempHigh"
              stroke="#f97316"
              name="High"
              dot={{ fill: '#f97316', r: 4 }}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="tempLow"
              stroke="#3b82f6"
              name="Low"
              dot={{ fill: '#3b82f6', r: 4 }}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Precipitation Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className={`rounded-xl p-4 border ${
          isDark ? 'bg-slate-800/50 border-slate-700/50' : 'bg-white border-slate-300'
        }`}
      >
        <div className="flex items-center gap-2 mb-4">
          <Droplets className="w-4 h-4 text-blue-400" />
          <p className={`text-sm font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            Precipitation & Rain Chance
          </p>
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartConfig.grid} />
            <XAxis dataKey="date" stroke={chartConfig.text} style={{ fontSize: '12px' }} />
            <YAxis stroke={chartConfig.text} style={{ fontSize: '12px' }} />
            <Tooltip
              contentStyle={{
                backgroundColor: chartConfig.tooltip,
                border: `1px solid ${isDark ? '#475569' : '#cbd5e1'}`,
                borderRadius: '8px',
                color: chartConfig.text,
              }}
              formatter={(value, name) => {
                if (name === 'Precipitation') return [`${value.toFixed(1)} mm`, name];
                return [`${value}%`, name];
              }}
            />
            <Legend />
            <Bar dataKey="precipitation" fill="#3b82f6" name="Precipitation (mm)" radius={[8, 8, 0, 0]} />
            <Bar dataKey="rainChance" fill="#06b6d4" name="Rain Chance (%)" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Wind Speed Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className={`rounded-xl p-4 border ${
          isDark ? 'bg-slate-800/50 border-slate-700/50' : 'bg-white border-slate-300'
        }`}
      >
        <div className="flex items-center gap-2 mb-4">
          <Wind className="w-4 h-4 text-cyan-400" />
          <p className={`text-sm font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            Wind Speed Trend
          </p>
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartConfig.grid} />
            <XAxis dataKey="date" stroke={chartConfig.text} style={{ fontSize: '12px' }} />
            <YAxis stroke={chartConfig.text} style={{ fontSize: '12px' }} />
            <Tooltip
              contentStyle={{
                backgroundColor: chartConfig.tooltip,
                border: `1px solid ${isDark ? '#475569' : '#cbd5e1'}`,
                borderRadius: '8px',
                color: chartConfig.text,
              }}
              formatter={(value) => fmtWind(value)}
            />
            <Legend />
            <Bar dataKey="windSpeed" fill="#06b6d4" name={`Wind Speed (${windUnit})`} radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </motion.div>
    </div>
  );
}