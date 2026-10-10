import React from 'react';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useUnits } from '@/components/useUnits';

// % risk sliders — also typeable
import { RISK_META } from '@/components/tcm/riskConfig';

const PERCENT_RISKS = [
  { key: 'tornado_risk',      label: 'Tornadoes',     color: 'from-red-500 to-red-700',       text: 'text-red-400',    border: 'border-red-500' },
  { key: 'hail_risk',         label: 'Hail',          color: 'from-sky-400 to-sky-600',        text: 'text-sky-400',    border: 'border-sky-500' },
  { key: 'flash_flood_risk',  label: 'Flash Flooding',color: 'from-blue-500 to-blue-700',      text: 'text-blue-400',   border: 'border-blue-500' },
  { key: 'strong_winds_risk', label: 'Strong Winds',  color: 'from-teal-400 to-teal-600',      text: 'text-teal-400',   border: 'border-teal-500' },
  { key: 'supercell_risk',    label: 'Supercells',    color: 'from-purple-500 to-purple-700',  text: 'text-purple-400', border: 'border-purple-500' },
];

// Additional hazards now use min/max risk-level pickers
// The canonical bands, straight from riskConfig — the same ladder the
// Thunderstorm graphic in the studio uses. This list used to be written out by
// hand here and was missing 'Slight', so a risk set in the studio at Slight had
// no matching option on a graphic.
const RISK_LEVELS = RISK_META.map(r => r.level);

const HAZARD_LEVEL_RISKS = [
  { key: 'high_lightning', label: 'High Lightning Risk', color: 'yellow' },
  { key: 'severe',         label: 'Severe',               color: 'orange' },
  { key: 'heavy_rain',     label: 'Heavy Rain',           color: 'blue' },
];

// TORRO scale including funnel cloud
const TORRO_SCALE = [
  { value: 'FC',  label: 'FC — Funnel Cloud (no contact)' },
  { value: 'T0',  label: 'T0 — Light (17–24 mph)' },
  { value: 'T1',  label: 'T1 — Mild (25–38 mph)' },
  { value: 'T2',  label: 'T2 — Moderate (39–54 mph)' },
  { value: 'T3',  label: 'T3 — Strong (55–72 mph)' },
  { value: 'T4',  label: 'T4 — Severe (73–92 mph)' },
  { value: 'T5',  label: 'T5 — Intense (93–114 mph)' },
  { value: 'T6',  label: 'T6 — Moderately Devastating (115–136 mph)' },
  { value: 'T7',  label: 'T7 — Strongly Devastating (137–160 mph)' },
  { value: 'T8',  label: 'T8 — Severely Devastating (161–186 mph)' },
  { value: 'T9',  label: 'T9 — Intensely Devastating (187–212 mph)' },
  { value: 'T10', label: 'T10 — Super Tornado (213+ mph)' },
];

export default function ThunderstormPanel({ data = {}, onChange }) {
  const set = (key, value) => onChange({ ...data, [key]: value });
  const { windUnit, precipUnit, hailUnit, hailToMm, hailFromMm } = useUnits();

  const windLabel = `Wind Speed (${windUnit})`;
  const rainLabel = `Rainfall (${precipUnit}/hr)`;
  const hailLabel = `Hail Diameter (${hailUnit})`;

  const clampPct = (v) => {
    const n = Number(v);
    if (Number.isNaN(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  };

  return (
    <div className="mt-4 pt-4 border-t border-purple-500/30 space-y-5">
      <p className="text-xs font-bold uppercase tracking-widest text-purple-400">⚡ Thunderstorm Risk Details</p>

      {/* % Risk sliders with typeable input */}
      <div className="space-y-3">
        <Label className="text-slate-300 text-sm">Percentage Risks</Label>
        {PERCENT_RISKS.map(({ key, label, color, text, border }) => {
          const val = data[key] ?? 0;
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-semibold ${text}`}>{label}</span>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={val}
                    onChange={e => set(key, clampPct(e.target.value))}
                    className={`w-16 h-7 text-right text-xs font-bold bg-slate-900/50 ${border} border ${text} px-2 py-0`}
                  />
                  <span className={`text-xs font-bold ${text}`}>%</span>
                </div>
              </div>
              <div className="relative h-2 rounded-full bg-slate-700 overflow-hidden">
                <div className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${color} transition-all`} style={{ width: `${val}%` }} />
                <input
                  type="range" min="0" max="100" step="1" value={val}
                  onChange={e => set(key, Number(e.target.value))}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Additional Hazards — min/max risk-level dropdowns */}
      <div className="space-y-3">
        <Label className="text-slate-300 text-sm">Additional Hazards (Min / Max Risk)</Label>
        <div className="space-y-2">
          {HAZARD_LEVEL_RISKS.map(({ key, label, color }) => {
            const minVal = data[`${key}_min`] ?? '';
            const maxVal = data[`${key}_max`] ?? '';
            return (
              <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                <span className={`text-xs font-semibold text-${color}-400`}>{label}</span>
                <select
                  value={minVal}
                  onChange={e => set(`${key}_min`, e.target.value || undefined)}
                  className={`bg-slate-900/50 border border-${color}-500/40 text-white text-xs rounded-md px-2 py-1.5 focus:outline-none focus:border-${color}-400`}
                >
                  <option value="">— Min —</option>
                  {RISK_LEVELS.map(lv => <option key={lv} value={lv}>{lv}</option>)}
                </select>
                <select
                  value={maxVal}
                  onChange={e => set(`${key}_max`, e.target.value || undefined)}
                  className={`bg-slate-900/50 border border-${color}-500/40 text-white text-xs rounded-md px-2 py-1.5 focus:outline-none focus:border-${color}-400`}
                >
                  <option value="">— Max —</option>
                  {RISK_LEVELS.map(lv => <option key={lv} value={lv}>{lv}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {/* Numeric specifics */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-teal-400 text-xs font-semibold">{windLabel}</Label>
          <Input
            type="number" min="0" placeholder="e.g. 60"
            value={data.wind_speed_mph ?? ''}
            onChange={e => set('wind_speed_mph', e.target.value ? Number(e.target.value) : undefined)}
            className="bg-slate-900/50 border-teal-500/40 text-white text-sm focus:border-teal-400"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-blue-400 text-xs font-semibold">{rainLabel}</Label>
          <Input
            type="number" min="0" placeholder="e.g. 25"
            value={data.rain_mm_per_hour ?? ''}
            onChange={e => set('rain_mm_per_hour', e.target.value ? Number(e.target.value) : undefined)}
            className="bg-slate-900/50 border-blue-500/40 text-white text-sm focus:border-blue-400"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-sky-400 text-xs font-semibold">{hailLabel}</Label>
          <Input
            type="number" min="0" placeholder={hailUnit === 'inches' ? 'e.g. 0.75' : 'e.g. 20'}
            value={hailFromMm(data.hail_diameter_mm)}
            onChange={e => set('hail_diameter_mm', hailToMm(e.target.value))}
            className="bg-slate-900/50 border-sky-500/40 text-white text-sm focus:border-sky-400"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-red-400 text-xs font-semibold">Tornado Intensity (TORRO)</Label>
          <select
            value={data.tornado_intensity ?? ''}
            onChange={e => set('tornado_intensity', e.target.value || undefined)}
            className="w-full bg-slate-900/50 border border-red-500/40 text-white text-xs rounded-md px-2 py-2 focus:outline-none focus:border-red-400"
          >
            <option value="">— None —</option>
            {TORRO_SCALE.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}