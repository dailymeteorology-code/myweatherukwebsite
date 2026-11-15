/* The Today card (Location Weather, 15 Nov 2026): the forecast in words for today, tonight and
   tomorrow (src/lib/location/forecastText.js), and the few things that matter most today as chips,
   each taking you to the card that says more. It sits under the hero and any warnings, so the day reads
   at a glance before anything else; it is one of the top cards the rain and snow land on
   (SkyBackdrop.jsx TOP_CARDS). */
import React, { useMemo } from 'react';
import {
  Sun, Moon, CloudLightning, Snowflake, AlertTriangle, CloudRain, CloudFog, Wind, Thermometer, ThermometerSnowflake, SunMedium, ChevronRight,
} from 'lucide-react';
import { useUnits } from '@/components/useUnits';
import { writtenForecast, mattersToday } from '@/lib/location/forecastText';
import { severityFill, severityInk } from '@/components/location/LocationWarnings';

const ICON = {
  warning: AlertTriangle, thunder: CloudLightning, snow: Snowflake, ice: Snowflake, rain: CloudRain, fog: CloudFog,
  wind: Wind, heat: Thermometer, cold: ThermometerSnowflake, frost: ThermometerSnowflake, uv: SunMedium,
};

export default function TodayCard({ model, warnings, onCard }) {
  const U = useUnits();
  const parts = useMemo(() => writtenForecast(model, U), [model, U]);
  const matters = useMemo(() => mattersToday(model, warnings, U), [model, warnings, U]);
  if (!parts.length && !matters.length) return null;
  const night = parts[0]?.key === 'tonight';
  return (
    <section className="lw-glass lw-card lw-today" aria-label="The forecast in words">
      <div className="lw-title">{night ? <Moon /> : <Sun />}The forecast in words</div>
      <div className="lw-today-text">
        {parts.map((p) => <p key={p.key}><b>{p.label}</b>{p.text}</p>)}
      </div>
      {matters.length > 0 && (
        <div className="lw-today-chips" role="list" aria-label="What matters today">
          {matters.map((m) => {
            const Icon = ICON[m.kind] || AlertTriangle;
            const tone = m.warning ? { '--chip': severityFill(m.warning.severity), '--chip-ink': severityInk(m.warning.severity) } : undefined;
            return (
              <button key={m.key} type="button" role="listitem" className={`lw-today-chip${m.warning ? ' is-warning' : ''}`} style={tone}
                onClick={() => onCard?.(m.card, m)} aria-label={`${m.label}${m.sub ? `, ${m.sub}` : ''}. Show more.`}>
                <Icon size={15} strokeWidth={2.2} />
                <span><b>{m.label}</b>{m.sub ? <small>{m.sub}</small> : null}</span>
                <ChevronRight size={14} className="lw-today-go" />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
