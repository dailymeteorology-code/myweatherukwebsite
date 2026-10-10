import React from 'react';
import { motion } from 'framer-motion';
import { Cloud, Sun, Droplets, Wind, Coffee, Utensils, MapPin, Lightbulb } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';

function getRecommendations(weather) {
  const recommendations = [];
  const desc = (weather.description || '').toLowerCase();
  const temp = weather.temperature?.max || 20;
  const rain = weather.rainChance || 0;
  const wind = weather.windSpeed || 0;

  // Rain-based recommendations
  if (rain > 60 || desc.includes('rain') || desc.includes('shower')) {
    recommendations.push({
      icon: Coffee,
      title: 'Indoor Activities',
      description: 'Visit a cozy café, museum, or indoor shopping center',
      color: 'bg-blue-500/20 text-blue-400',
      emoji: '☕'
    });
  }

  // Sunny weather recommendations
  if (desc.includes('sunny') || desc.includes('clear') && rain < 20) {
    recommendations.push({
      icon: MapPin,
      title: 'Outdoor Parks',
      description: 'Perfect day for hiking, picnicking, or visiting local parks',
      color: 'bg-green-500/20 text-green-400',
      emoji: '🏞️'
    });
  }

  // High wind recommendations
  if (wind > 25) {
    recommendations.push({
      icon: Wind,
      title: 'Water Sports',
      description: 'Great conditions for kitesurfing, windsurfing, or sailing',
      color: 'bg-cyan-500/20 text-cyan-400',
      emoji: '🏄'
    });
  }

  // Temperature-based recommendations
  if (temp < 5) {
    recommendations.push({
      icon: Sun,
      title: 'Warm Beverages',
      description: 'Hot chocolate, tea, or coffee at a café or home',
      color: 'bg-orange-500/20 text-orange-400',
      emoji: '🍫'
    });
  } else if (temp > 25) {
    recommendations.push({
      icon: Droplets,
      title: 'Cool Refreshments',
      description: 'Ice cream, cold drinks, or a beach visit',
      color: 'bg-teal-500/20 text-teal-400',
      emoji: '🍦'
    });
  }

  // Cloudy but dry recommendations
  if (desc.includes('cloud') && rain < 30) {
    recommendations.push({
      icon: Cloud,
      title: 'Photography',
      description: 'Beautiful diffused lighting for outdoor photography',
      color: 'bg-purple-500/20 text-purple-400',
      emoji: '📸'
    });
  }

  return recommendations.length > 0 ? recommendations : [
    {
      icon: Lightbulb,
      title: 'Mixed Conditions',
      description: 'Check the weather details for more recommendations',
      color: 'bg-yellow-500/20 text-yellow-400',
      emoji: '💡'
    }
  ];
}

export default function WeatherRecommendations({ weather }) {
  const { isDark } = useTheme();
  const recommendations = getRecommendations(weather);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <Lightbulb className={`w-4 h-4 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
        <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          Suggested Activities
        </p>
      </div>
      <div className="grid gap-3">
        {recommendations.map((rec, idx) => {
          const Icon = rec.icon;
          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className={`rounded-xl p-3 border ${
                isDark
                  ? 'bg-slate-800/50 border-slate-700/50'
                  : 'bg-slate-100 border-slate-300'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${rec.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-slate-800'}`}>
                    {rec.title}
                  </p>
                  <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {rec.description}
                  </p>
                </div>
                <span className="text-lg flex-shrink-0">{rec.emoji}</span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}