import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'weatherUnits';
const UNITS_CHANGED_EVENT = 'weatherUnitsChanged';

const defaults = {
  temperature: 'celsius',   // 'celsius' | 'fahrenheit'
  windSpeed: 'mph',         // 'mph' | 'kmh'
  precipitation: 'mm',      // 'mm' | 'inches'
  hail: 'mm',               // 'mm' | 'inches'
};

function readFromStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  } catch {
    return defaults;
  }
}

export function useUnits() {
  const [units, setUnits] = useState(readFromStorage);

  // Listen for changes made by other useUnits instances
  useEffect(() => {
    const handler = () => setUnits(readFromStorage());
    window.addEventListener(UNITS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(UNITS_CHANGED_EVENT, handler);
  }, []);

  const updateUnit = useCallback((key, value) => {
    setUnits(prev => {
      const updated = { ...prev, [key]: value };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      // Notify all other useUnits instances on this page
      window.dispatchEvent(new Event(UNITS_CHANGED_EVENT));
      return updated;
    });
  }, []);

  const fmtTemp = (c) => {
    if (c == null) return 'N/A';
    if (units.temperature === 'fahrenheit') return `${Math.round(c * 9 / 5 + 32)}°F`;
    return `${Math.round(c)}°C`;
  };

  const tempUnit = units.temperature === 'fahrenheit' ? '°F' : '°C';

  const fmtWind = (mph) => {
    if (mph == null) return 'N/A';
    if (units.windSpeed === 'kmh') return `${Math.round(mph * 1.60934)} km/h`;
    return `${Math.round(mph)} mph`;
  };

  const windUnit = units.windSpeed === 'kmh' ? 'km/h' : 'mph';

  const fmtPrecip = (mm, label = 'Rainfall', color = 'text-blue-300') => {
    if (mm == null) return { value: 'N/A', label, color };
    if (units.precipitation === 'inches') {
      return { value: `${(mm / 25.4).toFixed(2)} in`, label, color };
    }
    return { value: `${mm.toFixed(1)} mm`, label, color };
  };

  const fmtSnow = (cm) => {
    if (cm == null) return 'N/A';
    if (units.precipitation === 'inches') return `${(cm * 0.393701).toFixed(2)} in`;
    return `${cm.toFixed(1)} cm`;
  };

  const precipUnit = units.precipitation === 'inches' ? 'in' : 'mm';

  const fmtHail = (mm) => {
    if (mm == null) return 'N/A';
    if (units.hail === 'inches') return `${(mm / 25.4).toFixed(2)} in`;
    return `${mm} mm`;
  };

  const hailUnit = units.hail === 'inches' ? 'in' : 'mm';

  // Convert from display unit back to mm for storage
  const hailToMm = (val) => {
    if (val == null || val === '') return undefined;
    return units.hail === 'inches' ? Math.round(Number(val) * 25.4) : Number(val);
  };

  // Convert stored mm to display unit
  const hailFromMm = (mm) => {
    if (mm == null) return '';
    if (units.hail === 'inches') return (mm / 25.4).toFixed(2);
    return mm;
  };

  return { units, updateUnit, fmtTemp, tempUnit, fmtWind, windUnit, fmtPrecip, fmtSnow, precipUnit, fmtHail, hailUnit, hailToMm, hailFromMm };
}