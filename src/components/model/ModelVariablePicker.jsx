/* Variable chooser, grouped so 22 variables read as six short families rather
   than one long list. Clicking a group heading toggles the whole family. */
import React from 'react';
import { MODEL_VARIABLES, MODEL_GROUPS } from '@/lib/openMeteoModel';

export default function ModelVariablePicker({ visibleKeys, onChange }) {
  const toggle = (key) => onChange(
    visibleKeys.includes(key) ? visibleKeys.filter(k => k !== key) : [...visibleKeys, key]
  );

  const toggleGroup = (group) => {
    const keys = MODEL_VARIABLES.filter(v => v.group === group).map(v => v.key);
    const allOn = keys.every(k => visibleKeys.includes(k));
    onChange(allOn
      ? visibleKeys.filter(k => !keys.includes(k))
      : [...new Set([...visibleKeys, ...keys])]);
  };

  const chip = (on) => ({
    padding: '4px 10px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 11.5, fontWeight: 700,
    background: on ? 'rgba(56,189,248,0.16)' : 'rgba(148,163,184,0.07)',
    border: `1px solid ${on ? '#38bdf8' : 'rgba(148,163,184,0.2)'}`,
    color: on ? '#7dd3fc' : '#94a3b8',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {MODEL_GROUPS.map(group => {
        const vars = MODEL_VARIABLES.filter(v => v.group === group);
        return (
          <div key={group} style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <button onClick={() => toggleGroup(group)} style={{
              width: 104, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 10.5, fontWeight: 800, letterSpacing: '0.09em',
              textTransform: 'uppercase', color: '#64748b',
            }}>{group}</button>
            {vars.map(v => (
              <button key={v.key} onClick={() => toggle(v.key)} style={chip(visibleKeys.includes(v.key))}>
                {v.label}
              </button>
            ))}
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 7 }}>
        <button onClick={() => onChange(MODEL_VARIABLES.map(v => v.key))} style={chip(false)}>Select all</button>
        <button onClick={() => onChange([])} style={chip(false)}>Clear all</button>
      </div>
    </div>
  );
}