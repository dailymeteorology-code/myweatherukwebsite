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

/** Thumbnail picker shared by the snow graphics; it sits in the studio's glass controls
    (studio/StudioUI), so it takes their light or dark colours. */
export function SnowBackgroundPicker({ value, onChange }) {
  return (
    <div>
      <span className="sg-label">Background</span>
      <div className="sg-row" style={{ gap: 8 }}>
        {SNOW_BACKGROUNDS.map((b) => {
          const on = value === b.id;
          return (
            <button key={b.id} type="button" title={b.label} aria-pressed={on} onClick={() => { writeSnowBgId(b.id); onChange(b.id); }} style={{
              width: 66, padding: 0, borderRadius: 11, overflow: 'hidden', cursor: 'pointer', font: 'inherit',
              border: `2px solid ${on ? 'var(--sg-accent)' : 'var(--sg-border2)'}`, background: 'var(--sg-field)',
            }}>
              <img src={b.url} alt="" style={{ display: 'block', width: '100%', height: 64, objectFit: 'cover' }} />
              <span style={{ display: 'block', fontSize: 10, fontWeight: 700, padding: '3px 0', color: on ? 'var(--sg-text)' : 'var(--sg-mid)' }}>{b.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
