/**
 * DrawnAreaLocationsModal
 *
 * Lists every city / large town that falls inside the admin-drawn polygons on
 * the TCM outlook map. Used as a sanity check before publishing — "did I
 * actually cover the places I meant to cover?".
 *
 * Inputs:
 *   - open       : whether the modal is visible
 *   - onClose    : close handler
 *   - shapes     : the raw drawShapes array from WeatherPatterns. Each shape:
 *                    { riskLevel: 'Slight' | 'Moderate' | …,
 *                      latLngs:  [[lat, lon], [lat, lon], …] }
 *
 * We test every city in CITY_DB against every polygon. The highest risk-level
 * polygon a city sits inside wins (so a city under a "Moderate" zone and a
 * "Slight" zone is shown as Moderate). Cities outside every polygon are
 * skipped — this is a "what's in my drawn area", not a nearest-neighbour
 * lookup.
 */

import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, X, Globe } from 'lucide-react';
import { CITY_DB } from '@/components/tcm/cityDB';

// Risk-level ordering (highest wins when a city sits inside multiple shapes).
const RISK_ORDER = ['Very Low', 'Low', 'Marginal', 'Slight', 'Moderate', 'High', 'Severe'];
const RISK_COLOUR = {
  'Very Low': '#22aa52',
  'Low':      '#65a30d',
  'Marginal': '#ca8a04',
  'Slight':   '#ea580c',
  'Moderate': '#dc2626',
  'High':     '#7e22ce',
  'Severe':   '#0f172a',
};

// Standard ray-casting point-in-polygon. Polygon points are [lat, lon] pairs.
// We test in (lat, lon) space which is fine at UK latitudes for visual containment.
function pointInPolygon(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > lon) !== (yj > lon)) &&
      (lat < (xj - xi) * (lon - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export default function DrawnAreaLocationsModal({ open, onClose, shapes = [] }) {
  // For each city, find the highest risk-level polygon that contains it.
  const impacted = useMemo(() => {
    if (!shapes.length) return [];
    const out = [];
    for (const city of CITY_DB) {
      let bestLevel = null;
      let bestIdx = -1;
      for (const shape of shapes) {
        if (!shape?.latLngs?.length || shape.latLngs.length < 3) continue;
        if (pointInPolygon(city.lat, city.lon, shape.latLngs)) {
          const idx = RISK_ORDER.indexOf(shape.riskLevel);
          if (idx > bestIdx) { bestIdx = idx; bestLevel = shape.riskLevel; }
        }
      }
      if (bestLevel) out.push({ ...city, riskLevel: bestLevel });
    }
    // Highest risk first, then alphabetical.
    out.sort((a, b) => {
      const da = RISK_ORDER.indexOf(b.riskLevel) - RISK_ORDER.indexOf(a.riskLevel);
      return da !== 0 ? da : a.name.localeCompare(b.name);
    });
    return out;
  }, [shapes]);

  // Group impacted cities by country for display.
  const byCountry = useMemo(() => {
    const m = new Map();
    for (const c of impacted) {
      if (!m.has(c.country)) m.set(c.country, []);
      m.get(c.country).push(c);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [impacted]);

  if (!open) return null;

  return createPortal(
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 999999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,6,0.88)', backdropFilter: 'blur(18px)', padding: 16,
      }}
    >
      <div style={{
        background: 'linear-gradient(160deg, #0a0f1e 0%, #080c18 100%)',
        border: '1px solid rgba(255,255,255,0.09)', borderRadius: 18,
        width: '100%', maxWidth: 720, maxHeight: '88vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 60px 140px rgba(0,0,0,0.85)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)',
          flexShrink: 0,
          background: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(167,139,250,0.06))',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: 'rgba(245,158,11,0.18)', border: '1px solid rgba(245,158,11,0.40)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MapPin style={{ width: 16, height: 16, color: '#f59e0b' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.98rem', fontWeight: 800, color: '#f1f5f9' }}>
              Locations in your drawn area
            </div>
            <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 1 }}>
              {impacted.length === 0
                ? 'No cities or towns sit inside the currently drawn shapes'
                : `${impacted.length} cities & towns across ${byCountry.length} region${byCountry.length === 1 ? '' : 's'}`}
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 30, height: 30, borderRadius: 8, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.08)', background: 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#64748b', flexShrink: 0,
          }}>
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 20px' }}>
          {impacted.length === 0 ? (
            <div style={{
              padding: '40px 20px', textAlign: 'center',
              color: '#475569', fontSize: '0.82rem', lineHeight: 1.6,
            }}>
              Draw a polygon over an area and the cities & towns inside it
              will be listed here.
            </div>
          ) : byCountry.map(([country, cities]) => (
            <div key={country} style={{ marginBottom: 16 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: '0.62rem', fontWeight: 800, color: '#94a3b8',
                textTransform: 'uppercase', letterSpacing: '0.12em',
                marginBottom: 8, paddingBottom: 6,
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}>
                <Globe style={{ width: 11, height: 11, color: '#475569' }} />
                {country}
                <span style={{ color: '#475569' }}>·</span>
                <span style={{ color: '#64748b' }}>{cities.length}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {cities.map(c => {
                  const colour = RISK_COLOUR[c.riskLevel] || '#64748b';
                  return (
                    <span key={c.name} title={`${c.name} — ${c.riskLevel} risk`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '5px 11px', borderRadius: 99,
                        background: `${colour}1c`, border: `1px solid ${colour}55`,
                        fontSize: '0.74rem', fontWeight: 600, color: '#f1f5f9',
                      }}>
                      <span style={{
                        width: 7, height: 7, borderRadius: '50%',
                        background: colour, flexShrink: 0,
                      }} />
                      {c.name}
                      <span style={{
                        fontSize: '0.6rem', fontWeight: 700, color: colour,
                        textTransform: 'uppercase', letterSpacing: '0.05em',
                      }}>{c.riskLevel}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        {impacted.length > 0 && (
          <div style={{
            padding: '10px 18px', borderTop: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: '0.66rem', color: '#475569', flexShrink: 0,
          }}>
            <span>Tested against {CITY_DB.length} UK & European cities</span>
            <button onClick={() => {
              const txt = impacted.map(c => `${c.name}, ${c.country} (${c.riskLevel})`).join('\n');
              navigator.clipboard?.writeText(txt).catch(() => {});
            }} style={{
              padding: '4px 10px', borderRadius: 7, cursor: 'pointer',
              background: 'rgba(56,189,248,0.10)', border: '1px solid rgba(56,189,248,0.30)',
              color: '#38bdf8', fontSize: '0.66rem', fontWeight: 700,
            }}>
              Copy list
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}