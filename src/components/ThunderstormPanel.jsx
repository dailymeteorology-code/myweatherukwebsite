import React from 'react';
import { Tornado, CloudHail, Waves, Wind, CloudLightning, Zap, AlertTriangle, CloudRain } from 'lucide-react';
import { useUnits } from '@/components/useUnits';
import { GRAPHIC_LEVEL_NAMES, GraphicLevelPill, graphicLevel, levelOfPercent, normLevel } from '@/components/graphics/GraphicMeta';

/* The thunderstorm details of a forecast graphic, inside the add / edit sheet (ForecastSection),
   drawn on the sheet's glass tokens so it follows the light and dark themes.

   Every level here is the Thunderstorm graphic's own: a percentage is placed on its ladder as it
   is set (40% reads ENH, in ENH's colour, as the graphic's key would draw it), and the lowest and
   highest bands are picked by the graphic's labels, TSTM to SVRE. The stored keys are unchanged,
   so graphics already published read exactly as before. Styles: .gm-ts-* in ForecastSection. */

const PERCENT_RISKS = [
  { key: 'tornado_risk', label: 'Tornadoes', Icon: Tornado },
  { key: 'hail_risk', label: 'Hail', Icon: CloudHail },
  { key: 'flash_flood_risk', label: 'Flash flooding', Icon: Waves },
  { key: 'strong_winds_risk', label: 'Strong winds', Icon: Wind },
  { key: 'supercell_risk', label: 'Supercells', Icon: CloudLightning },
];

const HAZARD_LEVEL_RISKS = [
  { key: 'high_lightning', label: 'High lightning', Icon: Zap },
  { key: 'severe', label: 'Severe', Icon: AlertTriangle },
  { key: 'heavy_rain', label: 'Heavy rain', Icon: CloudRain },
];

// TORRO scale including funnel cloud
const TORRO_SCALE = [
  { value: 'FC', label: 'FC — Funnel cloud (no contact)' },
  { value: 'T0', label: 'T0 — Light (17–24 mph)' },
  { value: 'T1', label: 'T1 — Mild (25–38 mph)' },
  { value: 'T2', label: 'T2 — Moderate (39–54 mph)' },
  { value: 'T3', label: 'T3 — Strong (55–72 mph)' },
  { value: 'T4', label: 'T4 — Severe (73–92 mph)' },
  { value: 'T5', label: 'T5 — Intense (93–114 mph)' },
  { value: 'T6', label: 'T6 — Moderately devastating (115–136 mph)' },
  { value: 'T7', label: 'T7 — Strongly devastating (137–160 mph)' },
  { value: 'T8', label: 'T8 — Severely devastating (161–186 mph)' },
  { value: 'T9', label: 'T9 — Intensely devastating (187–212 mph)' },
  { value: 'T10', label: 'T10 — Super tornado (213+ mph)' },
];

const levelOption = (lv) => {
  const g = graphicLevel(lv);
  return g ? `${g.short}${g.range ? ` · ${g.range}` : ''}` : lv;
};

export default function ThunderstormPanel({ data = {}, onChange }) {
  const set = (key, value) => onChange({ ...data, [key]: value });
  const { hailUnit, hailToMm, hailFromMm } = useUnits();
  const clampPct = (v) => {
    const n = Number(v);
    return Number.isNaN(n) ? 0 : Math.max(0, Math.min(100, Math.round(n)));
  };
  const num = (v) => (v === '' || v == null ? undefined : Number(v));

  return (
    <div className="gm-ts">
      <div className="gm-ts-group">
        <p className="gm-ts-label">Chance of each hazard <small>placed on the graphic&rsquo;s ladder as you set it</small></p>
        {PERCENT_RISKS.map(({ key, label, Icon }) => {
          const val = typeof data[key] === 'number' ? data[key] : Number(data[key]) || 0;
          const band = levelOfPercent(val);
          const g = graphicLevel(band);
          return (
            <div key={key} className="gm-ts-row" style={{ '--c': g ? g.color : 'var(--ink-3)' }}>
              <span className="gm-ts-name"><Icon />{label}</span>
              <input type="range" className="gm-ts-range" min="0" max="100" step="1" value={val} aria-label={`${label} chance`}
                style={{ '--p': `${val}%` }} onChange={(e) => set(key, Number(e.target.value))} />
              <span className="gm-ts-pct">
                <input type="number" className="gm-input" min="0" max="100" step="1" value={val} aria-label={`${label} percent`}
                  onChange={(e) => set(key, clampPct(e.target.value))} />%
              </span>
              <span className="gm-ts-band">{band ? <GraphicLevelPill level={band} /> : <em>None</em>}</span>
            </div>
          );
        })}
      </div>

      <div className="gm-ts-group">
        <p className="gm-ts-label">Lowest to highest band</p>
        {HAZARD_LEVEL_RISKS.map(({ key, label, Icon }) => (
          <div key={key} className="gm-ts-pair">
            <span className="gm-ts-name"><Icon />{label}</span>
            <select className="gm-select" value={normLevel(data[`${key}_min`]) || ''} aria-label={`${label}: lowest band`}
              onChange={(e) => set(`${key}_min`, e.target.value || undefined)}>
              <option value="">Lowest —</option>
              {GRAPHIC_LEVEL_NAMES.map((lv) => <option key={lv} value={lv}>{levelOption(lv)}</option>)}
            </select>
            <select className="gm-select" value={normLevel(data[`${key}_max`]) || ''} aria-label={`${label}: highest band`}
              onChange={(e) => set(`${key}_max`, e.target.value || undefined)}>
              <option value="">Highest —</option>
              {GRAPHIC_LEVEL_NAMES.map((lv) => <option key={lv} value={lv}>{levelOption(lv)}</option>)}
            </select>
          </div>
        ))}
      </div>

      {/* stored as mph and mm/h whatever the reader's units, so they are asked for in those */}
      <div className="gm-ts-measures">
        <label className="gm-field"><span>Gusts <small>mph</small></span>
          <input type="number" min="0" className="gm-input" placeholder="e.g. 60" value={data.wind_speed_mph ?? ''} onChange={(e) => set('wind_speed_mph', num(e.target.value))} />
        </label>
        <label className="gm-field"><span>Rain rate <small>mm/h</small></span>
          <input type="number" min="0" step="0.5" className="gm-input" placeholder="e.g. 25" value={data.rain_mm_per_hour ?? ''} onChange={(e) => set('rain_mm_per_hour', num(e.target.value))} />
        </label>
        <label className="gm-field"><span>Hail size <small>{hailUnit}</small></span>
          <input type="number" min="0" step="any" className="gm-input" placeholder={hailUnit === 'inches' ? 'e.g. 0.75' : 'e.g. 20'} value={hailFromMm(data.hail_diameter_mm)} onChange={(e) => set('hail_diameter_mm', hailToMm(e.target.value))} />
        </label>
        <label className="gm-field"><span>Tornado intensity <small>TORRO</small></span>
          <select className="gm-select" value={data.tornado_intensity ?? ''} onChange={(e) => set('tornado_intensity', e.target.value || undefined)}>
            <option value="">None</option>
            {TORRO_SCALE.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
