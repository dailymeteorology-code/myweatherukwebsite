/* The visitor's units (lib/preferences), and the numbers in them. Everything that shows a
   temperature, a wind speed, a rain or snow amount or a hail size goes through here, so a change
   in Settings shows everywhere at once. Values come in as °C, mph, mm and cm. */
import { useCallback, useMemo } from 'react';
import { usePreferences } from '@/lib/preferences';

const WIND = {
  mph: { unit: 'mph', f: 1 },
  kmh: { unit: 'km/h', f: 1.609344 },
  knots: { unit: 'kt', f: 0.868976 },
  ms: { unit: 'm/s', f: 0.44704 },
};

export function useUnits() {
  const { prefs, setPref } = usePreferences();
  const units = prefs.units;
  const updateUnit = useCallback((key, value) => setPref(`units.${key}`, value), [setPref]);

  return useMemo(() => {
    const F = units.temperature === 'fahrenheit';
    const wind = WIND[units.windSpeed] || WIND.mph;
    const inches = units.precipitation === 'inches';
    const hailInches = units.hail === 'inches';

    /** °C in the chosen scale (a number), and with its unit. */
    const temp = (c) => (c == null ? null : F ? (c * 9) / 5 + 32 : c);
    const fmtTemp = (c) => (c == null ? 'N/A' : `${Math.round(temp(c))}${F ? '°F' : '°C'}`);
    /** mph in the chosen speed unit (a number), and with its unit. */
    const windSpeed = (mph) => (mph == null ? null : mph * wind.f);
    const fmtWind = (mph) => (mph == null ? 'N/A' : `${Math.round(windSpeed(mph))} ${wind.unit}`);
    /** mm in mm or inches (a number), and with its unit. */
    const precip = (mm) => (mm == null ? null : inches ? mm / 25.4 : mm);
    const fmtPrecip = (mm, label = 'Rainfall', color = 'text-blue-300') => ({
      value: mm == null ? 'N/A' : inches ? `${(mm / 25.4).toFixed(2)} in` : `${mm.toFixed(1)} mm`, label, color,
    });
    const fmtRain = (mm, d = 1) => (mm == null ? 'N/A' : inches ? `${(mm / 25.4).toFixed(2)} in` : `${mm.toFixed(d)} mm`);
    const fmtRate = (mmh) => (mmh == null ? 'N/A' : inches ? `${(mmh / 25.4).toFixed(2)} in/h` : `${mmh.toFixed(1)} mm/h`);
    const fmtSnow = (cm) => (cm == null ? 'N/A' : inches ? `${(cm * 0.393701).toFixed(1)} in` : `${cm.toFixed(1)} cm`);
    const fmtHail = (mm) => (mm == null ? 'N/A' : hailInches ? `${(mm / 25.4).toFixed(2)} in` : `${mm} mm`);
    /* the hail size typed into a form, in the chosen unit, to mm and back */
    const hailToMm = (val) => (val == null || val === '' ? undefined : hailInches ? Math.round(Number(val) * 25.4) : Number(val));
    const hailFromMm = (mm) => (mm == null ? '' : hailInches ? (mm / 25.4).toFixed(2) : mm);

    return {
      units, updateUnit,
      temp, fmtTemp, tempUnit: F ? '°F' : '°C', isF: F,
      windSpeed, fmtWind, windUnit: wind.unit,
      precip, fmtPrecip, fmtRain, fmtRate, fmtSnow, precipUnit: inches ? 'in' : 'mm',
      fmtHail, hailUnit: hailInches ? 'in' : 'mm', hailToMm, hailFromMm,
    };
  }, [units, updateUnit]);
}
