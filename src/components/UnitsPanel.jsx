import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Thermometer, Wind, Droplets, Check } from 'lucide-react';
import { useUnits } from '@/components/useUnits';

function UnitOption({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
        active
          ? 'bg-sky-600 border-sky-500 text-white shadow-sm'
          : 'bg-white border-slate-200 text-slate-600 hover:border-sky-400 hover:text-sky-600'
      }`}
    >
      {active && <Check className="w-3.5 h-3.5" />}
      {children}
    </button>
  );
}

export default function UnitsPanel({ isOpen, onClose }) {
  const { units, updateUnit } = useUnits();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/40 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            className="fixed top-0 right-0 h-full w-80 bg-white shadow-2xl z-50 flex flex-col"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Display Units</h2>
                <p className="text-xs text-slate-400 mt-0.5">Preferences saved automatically</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Options */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Temperature */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-orange-50">
                    <Thermometer className="w-4 h-4 text-orange-500" />
                  </div>
                  <span className="text-sm font-medium text-slate-700">Temperature</span>
                </div>
                <div className="flex flex-col gap-2">
                  <UnitOption active={units.temperature === 'celsius'} onClick={() => updateUnit('temperature', 'celsius')}>
                    °C — Celsius
                  </UnitOption>
                  <UnitOption active={units.temperature === 'fahrenheit'} onClick={() => updateUnit('temperature', 'fahrenheit')}>
                    °F — Fahrenheit
                  </UnitOption>
                </div>
              </div>

              {/* Wind Speed */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-cyan-50">
                    <Wind className="w-4 h-4 text-cyan-500" />
                  </div>
                  <span className="text-sm font-medium text-slate-700">Wind Speed</span>
                </div>
                <div className="flex flex-col gap-2">
                  <UnitOption active={units.windSpeed === 'mph'} onClick={() => updateUnit('windSpeed', 'mph')}>
                    mph — Miles per hour
                  </UnitOption>
                  <UnitOption active={units.windSpeed === 'kmh'} onClick={() => updateUnit('windSpeed', 'kmh')}>
                    km/h — Kilometres per hour
                  </UnitOption>
                </div>
              </div>

              {/* Precipitation */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-blue-50">
                    <Droplets className="w-4 h-4 text-blue-500" />
                  </div>
                  <span className="text-sm font-medium text-slate-700">Precipitation</span>
                </div>
                <div className="flex flex-col gap-2">
                  <UnitOption active={units.precipitation === 'mm'} onClick={() => updateUnit('precipitation', 'mm')}>
                    mm — Millimetres
                  </UnitOption>
                  <UnitOption active={units.precipitation === 'inches'} onClick={() => updateUnit('precipitation', 'inches')}>
                    in — Inches
                  </UnitOption>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}