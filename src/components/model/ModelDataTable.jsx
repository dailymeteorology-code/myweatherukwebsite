/* Hourly model table — hours down, variables across.

   22 variables cannot fit a phone screen, so the table scrolls sideways with
   the hour column pinned; without the pin you lose track of which row you are
   reading the moment you scroll. */
import React from 'react';
import { MODEL_VARIABLES, formatValue } from '@/lib/openMeteoModel';

export default function ModelDataTable({ rows, visibleKeys }) {
  const cols = MODEL_VARIABLES.filter(v => visibleKeys.includes(v.key));

  return (
    <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid rgba(148,163,184,0.18)' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr>
            <th style={{
              position: 'sticky', left: 0, zIndex: 2, textAlign: 'left',
              padding: '9px 12px', background: '#0b1324', color: '#7dd3fc',
              fontWeight: 800, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
              borderBottom: '1px solid rgba(148,163,184,0.2)',
            }}>Hour</th>
            {cols.map(v => (
              <th key={v.key} style={{
                padding: '9px 12px', whiteSpace: 'nowrap', textAlign: 'right',
                background: '#0b1324', color: '#cbd5e1', fontWeight: 700, fontSize: 11.5,
                borderBottom: '1px solid rgba(148,163,184,0.2)',
              }}>
                {v.label}
                {v.unit && <span style={{ color: '#64748b', fontWeight: 600 }}> ({v.unit})</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.time} style={{ background: i % 2 ? 'rgba(148,163,184,0.04)' : 'transparent' }}>
              <td style={{
                position: 'sticky', left: 0, zIndex: 1, padding: '7px 12px', fontWeight: 800,
                color: '#f1f5f9', background: i % 2 ? '#0a1120' : '#070d18',
                borderBottom: '1px solid rgba(148,163,184,0.08)',
              }}>{row.hour}</td>
              {cols.map(v => (
                <td key={v.key} style={{
                  padding: '7px 12px', textAlign: 'right', whiteSpace: 'nowrap', color: '#cbd5e1',
                  borderBottom: '1px solid rgba(148,163,184,0.08)',
                }}>
                  {formatValue(row[v.key], v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {cols.length === 0 && (
        <p style={{ margin: 0, padding: '22px 14px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
          No variables selected — pick at least one above.
        </p>
      )}
    </div>
  );
}