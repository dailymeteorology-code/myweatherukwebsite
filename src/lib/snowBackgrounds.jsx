/**
 * Photo backgrounds for the snow graphics (Snow Chance, Snow Accumulation,
 * Snow Risk). Served from /uploads so html-to-image / canvas exports stay
 * same-origin. The two Wikimedia Commons photos are CC BY-SA 3.0, so their
 * credit is printed small on the graphic.
 */
import React from 'react';

export const SNOW_BACKGROUNDS = [
  { id: 'storm',  label: 'Snowstorm',     url: '/uploads/snow-bg.jpg',
    credit: 'Photo: Ximeg, CC BY-SA 3.0' },
  { id: 'forest', label: 'Snowy forest',  url: '/uploads/snow-bg-forest.jpg',
    credit: 'Photo: Brocken Inaglory, CC BY-SA 3.0' },
  { id: 'night',  label: 'Starry night',  url: '/uploads/snow-bg-night.webp', credit: '' },
];
export const snowBackground = (id) => SNOW_BACKGROUNDS.find((b) => b.id === id) || SNOW_BACKGROUNDS[0];

const BG_KEY = 'mwuk_snow_bg';
export function readSnowBgId() { try { return localStorage.getItem(BG_KEY) || 'storm'; } catch { return 'storm'; } }
export function writeSnowBgId(id) { try { localStorage.setItem(BG_KEY, id); } catch { /* storage blocked */ } }

/** Thumbnail picker shared by the three snow tools. */
export function SnowBackgroundPicker({ value, onChange, labelStyle }) {
  return (
    <div>
      <p style={{ ...labelStyle, margin: '0 0 8px' }}>Background</p>
      <div style={{ display: 'flex', gap: 8 }}>
        {SNOW_BACKGROUNDS.map((b) => {
          const on = value === b.id;
          return (
            <button key={b.id} type="button" title={b.label} onClick={() => { writeSnowBgId(b.id); onChange(b.id); }} style={{
              width: 62, padding: 0, borderRadius: 9, overflow: 'hidden', cursor: 'pointer', fontFamily: 'inherit',
              border: `2px solid ${on ? '#38bdf8' : 'rgba(148,163,184,0.2)'}`, background: '#0b1220',
            }}>
              <img src={b.url} alt="" style={{ display: 'block', width: '100%', height: 70, objectFit: 'cover' }} />
              <span style={{ display: 'block', fontSize: 9.5, fontWeight: 700, padding: '3px 0', color: on ? '#38bdf8' : '#94a3b8' }}>{b.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
