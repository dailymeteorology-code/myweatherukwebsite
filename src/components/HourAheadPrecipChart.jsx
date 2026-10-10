import React from 'react';
import { useTheme } from '@/components/ThemeContext';

// Y-axis intensity bands (top → bottom)
const Y_BANDS = ['Heavy', 'Mod.', 'Light'];

// Map precipRate (mm/hr) to 0–1 height using a log-friendly scale
function rateToHeight(rate) {
  if (!rate || rate <= 0) return 0;
  // Minimum visible bar for any precipitation
  if (rate < 0.1) return 0.05;
  // Light: 0.1–2, Mod: 2–5, Heavy: 5+
  const clamped = Math.min(rate, 15);
  return Math.min(1, Math.log10(clamped / 0.05) / Math.log10(15 / 0.05));
}

function barColor(type) {
  if (type === 'snow') return '#60a5fa'; // blue for snow
  if (type === 'sleet') return '#f97316'; // orange for sleet
  return '#06b6d4'; // teal for rain
}

function typeLabel(type) {
  if (type === 'snow') return 'Snow';
  if (type === 'sleet') return 'Sleet';
  if (type === 'none') return 'Dry';
  return 'Rain';
}

export default function HourAheadPrecipChart({ data }) {
  const { isDark } = useTheme();
  if (!data || data.length === 0) return null;

  const hasAnyPrecip = data.some(d => d.precipRate > 0);

  const CHART_H = 72; // px, height of the bar area
  const textCls = isDark ? 'text-slate-400' : 'text-slate-500';
  const gridAlpha = isDark ? 0.1 : 0.15;
  const borderAlpha = isDark ? 0.25 : 0.25;

  // Derive labels for every 15-min slot (Now + exact 15‑min marks)
  const labelSlots = data.map((slot, i) => {
    if (i === 0) return 'Now';
    return slot.label || null;
  });

  return (
    <div className={`rounded-2xl p-4 border transition-colors ${isDark ? 'bg-slate-800/50 border-slate-700/50' : 'bg-white border-slate-200'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <p className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>
          Precipitation — Next 4 Hours
        </p>
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
          hasAnyPrecip
            ? isDark ? 'bg-cyan-500/20 text-cyan-400' : 'bg-cyan-100 text-cyan-700'
            : isDark ? 'bg-slate-700/50 text-slate-400' : 'bg-slate-100 text-slate-500'
        }`}>
          {hasAnyPrecip ? '15-min intervals' : 'Dry conditions'}
        </span>
      </div>

       {/* Legend */}
       <div className="flex gap-4 mb-3 text-xs flex-wrap">
         <div className="flex items-center gap-1.5">
           <div style={{width: 10, height: 10, backgroundColor: '#06b6d4', borderRadius: '50%'}} />
           <span className={textCls}>Rain</span>
         </div>
         <div className="flex items-center gap-1.5">
           <div style={{width: 10, height: 10, backgroundColor: '#60a5fa', borderRadius: '50%'}} />
           <span className={textCls}>Snow</span>
         </div>
         <div className="flex items-center gap-1.5">
           <div style={{width: 10, height: 10, backgroundColor: '#f97316', borderRadius: '50%'}} />
           <span className={textCls}>Sleet</span>
         </div>
       </div>


      {/* Chart */}
      <div className="flex">
        {/* Y-axis labels */}
        <div
          className="flex flex-col justify-between select-none pr-2 shrink-0"
          style={{ height: CHART_H }}
        >
          {Y_BANDS.map(b => (
            <span key={b} className={`text-[10px] leading-none ${textCls}`}>{b}</span>
          ))}
        </div>

        {/* Plot area */}
        <div className="flex-1 flex flex-col">
          {/* Bar area with grid lines */}
          <div className="relative" style={{ height: CHART_H }}>
            {/* Horizontal grid lines at each band level */}
            {Y_BANDS.map((_, li) => (
              <div
                key={li}
                className="absolute left-0 right-0"
                style={{
                  top: `${(li / Y_BANDS.length) * 100}%`,
                  borderTop: `1px solid rgba(${isDark ? '148,163,184' : '100,116,139'},${gridAlpha})`,
                }}
              />
            ))}
            {/* Bottom axis line */}
            <div
              className="absolute left-0 right-0 bottom-0"
              style={{ borderTop: `1px solid rgba(${isDark ? '148,163,184' : '100,116,139'},${borderAlpha})` }}
            />

            {/* Bars */}
            <div className="absolute inset-0 flex items-end">
              {data.map((slot, i) => {
                const h = rateToHeight(slot.precipRate);
                const barPx = h > 0 ? Math.max(3, h * CHART_H) : 0;
                const color = barPx > 0 ? barColor(slot.type) : 'transparent';
                return (
                  <div
                    key={i}
                    className="flex-1 flex flex-col justify-end"
                    style={{ height: '100%', paddingInline: '15%' }}
                  >
                    <div
                      style={{
                        height: barPx,
                        backgroundColor: color,
                        borderRadius: '2px 2px 0 0',
                        transition: 'height 0.4s ease',
                      }}
                      title={`${typeLabel(slot.type)}${slot.precipRate > 0 ? ` • ${slot.precipRate} mm/hr` : ''}`}
                    />
                  </div>
                );
              })}
            </div>

            {/* Tick marks at hour boundaries */}
            <div className="absolute left-0 right-0 bottom-0 flex">
              {data.map((_, i) => (
                <div key={i} className="flex-1 relative">
                  {labelSlots[i] !== null && (
                    <div
                      className="absolute bottom-0 left-0"
                      style={{
                        width: 1,
                        height: 4,
                        backgroundColor: isDark ? '#64748b' : '#94a3b8',
                        transform: 'translateX(-50%)',
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* X-axis time labels */}
          <div className="relative flex" style={{ height: 28, marginTop: 4 }}>
            {data.map((_, i) => {
              const lbl = labelSlots[i];
              if (!lbl) return <div key={i} className="flex-1" />;
              const mm = typeof lbl === 'string' && lbl.includes(':') ? lbl.split(':')[1] : null;
              const show = i === 0 || (mm && ['00', '15', '30', '45'].includes(mm));
              return (
                <div key={i} className="flex-1 relative">
                  {show && (
                    <span
                      className={`absolute text-[10px] select-none ${textCls}`}
                      style={{ left: 0, top: 4, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}
                    >
                      {lbl}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}