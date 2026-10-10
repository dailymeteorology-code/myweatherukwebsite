import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { CloudLightning, Snowflake, Info, ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTheme } from '@/components/ThemeContext';

const THUNDERSTORM_CRITERIA = [
  { parameter: 'CAPE (Convective Available Potential Energy)', threshold: '> 500 J/kg', significance: 'Marginal convective potential; isolated storms possible', severity: 'marginal' },
  { parameter: 'CAPE', threshold: '500–1500 J/kg', significance: 'Moderate instability; scattered thunderstorms likely', severity: 'moderate' },
  { parameter: 'CAPE', threshold: '> 1500 J/kg', significance: 'High instability; severe thunderstorms possible', severity: 'high' },
  { parameter: 'Lifted Index (LI)', threshold: '0 to -3', significance: 'Marginally unstable atmosphere; some storm activity', severity: 'marginal' },
  { parameter: 'Lifted Index (LI)', threshold: '-3 to -6', significance: 'Moderately unstable; organised storms likely', severity: 'moderate' },
  { parameter: 'Lifted Index (LI)', threshold: '< -6', significance: 'Severely unstable; major convective outbreak possible', severity: 'high' },
  { parameter: 'Wind Shear (0–6 km)', threshold: '10–20 m/s', significance: 'Multicell thunderstorms possible', severity: 'moderate' },
  { parameter: 'Wind Shear (0–6 km)', threshold: '> 20 m/s', significance: 'Supercell and severe thunderstorm potential', severity: 'high' },
  { parameter: 'Precipitable Water', threshold: '> 30 mm', significance: 'Heavy rainfall from thunderstorms likely', severity: 'moderate' },
  { parameter: 'Storm Relative Helicity (SRH 0–3km)', threshold: '> 150 m²/s²', significance: 'Rotating updrafts possible; tornado threat increases', severity: 'high' },
];

const SNOWFALL_CRITERIA = [
  { parameter: 'Surface Temperature', threshold: '≤ 2°C', significance: 'Snow possible at low levels', severity: 'marginal' },
  { parameter: 'Surface Temperature', threshold: '≤ 0°C', significance: 'Widespread snow likely', severity: 'moderate' },
  { parameter: '850 hPa Temperature', threshold: '≤ -5°C', significance: 'Snow to low levels; heavy falls possible', severity: 'moderate' },
  { parameter: '850 hPa Temperature', threshold: '≤ -10°C', significance: 'Very heavy snowfall; significant accumulations likely', severity: 'high' },
  { parameter: 'Snowfall Rate', threshold: '1–2 cm/hr', significance: 'Moderate snow impact on travel', severity: 'moderate' },
  { parameter: 'Snowfall Rate', threshold: '> 2 cm/hr', significance: 'Heavy snow; major disruption expected', severity: 'high' },
  { parameter: 'Accumulated Snow (6 hr)', threshold: '2–5 cm', significance: 'Slippery surfaces; travel disruption', severity: 'marginal' },
  { parameter: 'Accumulated Snow (6 hr)', threshold: '5–15 cm', significance: 'Significant disruption; some road closures', severity: 'moderate' },
  { parameter: 'Accumulated Snow (6 hr)', threshold: '> 15 cm', significance: 'Severe disruption; widespread road/rail closures', severity: 'high' },
  { parameter: 'Wet Bulb Temperature', threshold: '≤ 0.5°C', significance: 'Snow/sleet at surface even above 2°C air temperature', severity: 'moderate' },
];

const SEVERITY_STYLE = {
  marginal: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300',
  moderate: 'bg-orange-500/10 border-orange-500/30 text-orange-300',
  high: 'bg-red-500/10 border-red-500/30 text-red-300',
};

const SEVERITY_DOT = {
  marginal: 'bg-yellow-400',
  moderate: 'bg-orange-500',
  high: 'bg-red-500',
};

function CriteriaTable({ criteria }) {
  return (
    <div className="space-y-3">
      {criteria.map((c, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -10 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.05 }}
          className={`flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl border ${SEVERITY_STYLE[c.severity]}`}
        >
          <div className="flex items-center gap-2 sm:w-48 flex-shrink-0">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${SEVERITY_DOT[c.severity]}`} />
            <span className="text-sm font-medium text-white">{c.parameter}</span>
          </div>
          <div className="sm:w-36 flex-shrink-0">
            <code className="text-xs font-mono bg-black/30 px-2 py-0.5 rounded text-white">{c.threshold}</code>
          </div>
          <p className="text-xs text-slate-300 flex-1">{c.significance}</p>
        </motion.div>
      ))}
    </div>
  );
}

export default function WeatherCriteria() {
  const [activeTab, setActiveTab] = useState('thunderstorm');
  const { isDark } = useTheme();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 px-4 py-10">
      <div className="max-w-4xl mx-auto">
        {/* Back button */}
        <Link to="/" className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-8 transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back to Home
        </Link>

        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">Weather Criteria</h1>
          <p className="text-slate-400">Reference thresholds used for thunderstorm and snowfall assessments</p>
        </motion.div>

        {/* Tab toggle */}
        <div className="flex gap-2 mb-8 bg-slate-800/60 border border-slate-700 rounded-2xl p-1 w-fit">
          <button
            onClick={() => setActiveTab('thunderstorm')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'thunderstorm' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <CloudLightning className="w-4 h-4" /> Thunderstorm
          </button>
          <button
            onClick={() => setActiveTab('snowfall')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'snowfall' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Snowflake className="w-4 h-4" /> Snowfall
          </button>
        </div>

        {/* Severity legend */}
        <div className="flex items-center gap-4 mb-6 text-xs text-slate-400 flex-wrap">
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400" /> Marginal</div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-500" /> Moderate</div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /> High</div>
        </div>

        <div className="bg-sky-500/10 border border-sky-500/20 rounded-2xl px-4 py-3 flex items-start gap-3 mb-6">
          <Info className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-sky-300">
            These thresholds are guidelines based on NWP model output and observational data. Always consider synoptic context, model uncertainty, and local topographic effects before issuing forecasts.
          </p>
        </div>

        {activeTab === 'thunderstorm' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} key="thunderstorm">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 rounded-xl bg-purple-500/20">
                <CloudLightning className="w-5 h-5 text-purple-400" />
              </div>
              <h2 className="text-xl font-bold text-white">Thunderstorm Criteria</h2>
            </div>
            <CriteriaTable criteria={THUNDERSTORM_CRITERIA} />
          </motion.div>
        )}

        {activeTab === 'snowfall' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} key="snowfall">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 rounded-xl bg-sky-500/20">
                <Snowflake className="w-5 h-5 text-sky-400" />
              </div>
              <h2 className="text-xl font-bold text-white">Snowfall Criteria</h2>
            </div>
            <CriteriaTable criteria={SNOWFALL_CRITERIA} />
          </motion.div>
        )}

        <motion.footer
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mt-12 text-center text-xs text-slate-600 pb-8"
        >
          Criteria based on standard UK meteorological forecasting thresholds
        </motion.footer>
      </div>
    </div>
  );
}