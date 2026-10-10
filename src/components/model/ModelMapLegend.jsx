/* Colour key for the model map — the variable's own ramp, with its stops
   labelled, so a shade on the map can be read back as a number. */
import React from 'react';
import { colourFor } from '@/lib/modelGrid';

export default function ModelMapLegend({ variable }) {
  const stops = variable.stops;
  const lo = stops[0][0], hi = stops[stops.length - 1][0];
  const steps = 60;
  const gradient = Array.from({ length: steps }, (_, i) => {
    const v = lo + ((hi - lo) * i) / (steps - 1);
    return colourFor(v, variable) || 'rgba(148,163,184,0.12)';
  }).join(',');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ height: 12, borderRadius: 99, background: `linear-gradient(90deg, ${gradient})`, border: '1px solid rgba(148,163,184,0.2)' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
        {stops.map(([v]) => <span key={v}>{v}</span>)}
      </div>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b' }}>
        {variable.label} ({variable.unit})
      </span>
    </div>
  );
}