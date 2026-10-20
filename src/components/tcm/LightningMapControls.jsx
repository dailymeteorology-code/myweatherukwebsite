import React from 'react';
import {
  Clock, RefreshCw, Camera,
  ShieldAlert, Palette,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';

// Inline equivalents of adminForceFetch / clearAdminForce from tcmFetchPolicy.js
// (inlined here to avoid a hard import dependency on the new exports)
const ADMIN_FORCE_KEY = 'tcm_admin_force_fetch';
function _adminForceFetch() {
  try { localStorage.setItem(ADMIN_FORCE_KEY, String(Date.now())); } catch {}
}

// Map display modes for the expanded Leaflet map section
// (mirrors the MAP_MODE_* constants in TCMSection.jsx so the pattern is
// consistent across every map in the app)
const LIVE_STRIKE_COLOUR_OPTIONS = [
  { id: 'age',    label: 'Age',    preview: 'linear-gradient(90deg,#fff,#fef08a,#facc15,#f97316,#ef4444,#e11d74,#a855f7,#6366f1,#64748b)' },
  { id: 'yellow', label: '●',      hex: '#facc15' },
  { id: 'white',  label: '●',      hex: '#ffffff' },
  { id: 'cyan',   label: '●',      hex: '#22d3ee' },
  { id: 'lime',   label: '●',      hex: '#84cc16' },
  { id: 'pink',   label: '●',      hex: '#f472b6' },
  { id: 'orange', label: '●',      hex: '#f97316' },
  { id: 'red',    label: '●',      hex: '#ef4444' },
  { id: 'purple', label: '●',      hex: '#a78bfa' },
];

export const MAP_MODE_STRIKES  = 'strikes';   // Live strikes + radar (default)
export const MAP_MODE_HEAT     = 'heatmap';   // Strike density heat overlay
export const MAP_MODE_RADAR    = 'radar';     // Radar only (no strike markers)
export const MAP_MODE_COMBINED = 'combined';  // All layers visible


export default function LightningMapControls({
  lightMode = false,
  timeTravelMode, setTimeTravelMode, exitTimeTravel,
  loadRadar, soundEnabled, setSoundEnabled, isAdmin,
  todayStrikesRef, isEuropeMap,
  // Callback for admin force-fetch (caller triggers the fetch after the flag is set)
  onAdminForceFetch,
  // Live strike colour
  liveStrikeColour,
  setLiveStrikeColour,
  // Box selection tool
  boxSelectMode,
  setBoxSelectMode,
}) {
  /* Every chip on this toolbar used to be hardcoded to a midnight-blue fill
     with slate text, which on the light theme was a row of near-black
     lozenges floating over a pale map. One set of tokens drives them all. */
  const chip = (on, accent) => ({
    display:'flex', alignItems:'center', gap:5, padding:'6px 11px', borderRadius:10,
    background: on ? `rgba(${hexToRgbStr(accent)},0.16)` : 'var(--lx-chip)',
    border: `1px solid ${on ? accent + '88' : 'var(--lx-chip-edge)'}`,
    color: on ? accent : 'var(--lx-chip-ink)',
    fontSize:'0.71rem', fontWeight:700, cursor:'pointer',
    backdropFilter:'blur(16px) saturate(170%)', WebkitBackdropFilter:'blur(16px) saturate(170%)',
    transition:'background .18s, color .18s, border-color .18s',
    pointerEvents:'all', fontFamily:'inherit', lineHeight:1.35,
  });

  return (
    <div style={{
      display:'flex', flexDirection:'column', gap:7, width:'100%',
      /* Local tokens so the chips can be plain CSS values rather than a
         ternary repeated forty times. */
      '--lx-chip':      lightMode ? 'rgba(255,255,255,0.78)' : 'rgba(8,14,28,0.78)',
      '--lx-chip-edge': lightMode ? 'rgba(15,23,42,0.12)'    : 'rgba(255,255,255,0.10)',
      '--lx-chip-ink':  lightMode ? '#475569'                : '#93a4bd',
      '--lx-faint':     lightMode ? 'rgba(71,85,105,0.62)'   : 'rgba(148,163,184,0.5)',
    }}>

      {/* Row 1 — map tools. The region switch, the connection state and the
          fullscreen button are not here: they are page-level, and they live
          once in the command bar above the map. */}
      <div className="tcm-map-row1" style={{ display:'flex', alignItems:'center', gap:6, pointerEvents:'all', flexWrap:'wrap' }}>
        <div className="tcm-sound-toggles" style={{ display:'flex', gap:5, pointerEvents:'all', flexWrap:'wrap' }}>
          {[
            { key:'strike', label:'⚡', title:'Strike Sound', state:soundEnabled, set:setSoundEnabled },
          ].map(({ key, label, title, state, set }) => (
            <button key={key} onClick={() => set(v => !v)} title={title}
              style={{ ...chip(state, '#22c55e'), fontSize:'0.78rem' }}>
              {label}
              <span style={{ fontSize:'0.62rem', fontWeight:700 }}>
                {state ? 'ON' : 'OFF'}
              </span>
            </button>
          ))}
        </div>

        <button onClick={() => { setTimeTravelMode(v => !v); if (timeTravelMode) exitTimeTravel(); }}
          style={chip(timeTravelMode, '#a78bfa')}>
          <Clock style={{width:11,height:11}}/> Archive
        </button>

        {isAdmin && (
          <>
            {/* Admin force-fetch — bypasses the UTC run-window gate */}
            <button
              onClick={async () => {
                _adminForceFetch();
                if (onAdminForceFetch) {
                  await onAdminForceFetch();
                } else {
                  alert('Force-fetch flag set — refresh the TCM outlook to pull a fresh run.');
                }
              }}
              title="Admin: force a TCM data refresh outside the normal run window"
              style={chip(true, '#ef4444')}>
              <ShieldAlert style={{width:11,height:11}}/> Force Fetch
            </button>

            <button onClick={async () => {
              try {
                await base44.functions.invoke('bulkImportLightningStrikes', {
                  strikes: todayStrikesRef.current,
                  region: isEuropeMap ? 'europe' : 'uk',
                });
                alert(`Snapshot saved: ${todayStrikesRef.current.length} strikes archived for all users`);
              } catch (e) {
                alert(`Snapshot failed: ${e?.message}`);
              }
            }}
            style={chip(true, '#f59e0b')}>
              <Camera style={{width:11,height:11}}/> Snapshot All Today
            </button>
          </>
        )}

        {/* Box selection tool */}
        {(boxSelectMode !== undefined && setBoxSelectMode !== undefined) && (
          <button onClick={() => setBoxSelectMode(v => !v)}
            title="Draw a box to count strikes inside"
            style={chip(boxSelectMode, '#38bdf8')}>
            &#9635; {boxSelectMode ? 'Drawing…' : 'Count Box'}
          </button>
        )}
        <button onClick={() => { loadRadar(); }} title="Refresh radar"
          style={chip(false, '#38bdf8')}>
          <RefreshCw style={{width:11,height:11}}/>
        </button>
      </div>

      {/* Row 2 — live strike colour picker */}
      {(liveStrikeColour !== undefined && setLiveStrikeColour !== undefined) && (
        <div className="tcm-colour-row" style={{ display:'flex', alignItems:'center', gap:5, pointerEvents:'all', flexWrap:'wrap' }}>
          <Palette style={{ width:11, height:11, color:'#a78bfa', flexShrink:0 }} />
          <span style={{ fontSize:'0.58rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--lx-faint)', marginRight:2 }}>Strike colour</span>
          {LIVE_STRIKE_COLOUR_OPTIONS.map(opt => {
            const active = liveStrikeColour === opt.id;
            const borderCol = active ? (opt.hex ? opt.hex + 'aa' : '#a78bfaaa') : 'rgba(255,255,255,0.08)';
            return (
              <button key={opt.id} onClick={() => setLiveStrikeColour(opt.id)}
                title={opt.id === 'age' ? 'Age-based gradient' : opt.id}
                style={{
                  ...chip(active, opt.hex || '#a78bfa'),
                  padding: opt.id === 'age' ? '3px 9px' : '3px 7px',
                  fontSize: opt.id === 'age' ? '0.6rem' : '0.85rem',
                  borderColor: borderCol, lineHeight: 1,
                }}>
                {opt.id === 'age' ? 'Age' : <span style={{ color: opt.hex }}>●</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Minimal hex → "r,g,b" helper (avoids importing the shared utils)
function hexToRgbStr(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}