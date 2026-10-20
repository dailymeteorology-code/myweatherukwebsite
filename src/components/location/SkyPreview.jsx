/* Sky preview (admins only): every background the Location page can show, for each weather type
   at each time of day, on the live page. Choose a time of day and a weather type, change the
   wind, hide the page to see the sky on its own, or let it play through all of them. */
import React, { useEffect, useState } from 'react';
import { Palette, X, Eye, EyeOff, Play, Pause } from 'lucide-react';
import WxIcon from './WxIcon';
import { condLabel } from '@/lib/ukvLocation';

const CONDS = ['clear', 'mostlyClear', 'partly', 'cloudy', 'overcast', 'fog', 'mist', 'drizzle', 'lightRain', 'rain', 'heavyRain',
  'showers', 'heavyShowers', 'thunder', 'sleet', 'snow', 'heavySnow', 'snowShowers', 'hail'];
/* [key, label, sun elevation (degrees), morning] */
const TIMES = [['day', 'Day', 40, true], ['sunrise', 'Sunrise', 2, true], ['sunset', 'Sunset', 2, false], ['night', 'Night', -20, false]];
const RATE = { drizzle: 0.3, lightRain: 0.6, rain: 2, heavyRain: 8, showers: 2, heavyShowers: 6, thunder: 6, sleet: 1, snow: 1, heavySnow: 3, snowShowers: 1, hail: 3 };
const CLOUD = { clear: 5, mostlyClear: 25, partly: 55, cloudy: 85, overcast: 100, fog: 100, mist: 70 };

export const PREVIEW_START = { cond: 'clear', time: 'day', wind: 12 };

/** the backdrop's settings for a preview choice */
export function previewSky(p) {
  const t = TIMES.find((x) => x[0] === p.time) || TIMES[0];
  return { cond: p.cond, sun: t[2], morning: t[3], wind: p.wind, wdir: 240, rate: RATE[p.cond] ?? 0, cloud: CLOUD[p.cond] ?? 92 };
}

/* the next stop when playing: every time of day for a weather type, then the next type */
function step(p) {
  const ti = TIMES.findIndex((t) => t[0] === p.time);
  if (ti < TIMES.length - 1) return { ...p, time: TIMES[ti + 1][0] };
  return { ...p, time: TIMES[0][0], cond: CONDS[(CONDS.indexOf(p.cond) + 1) % CONDS.length] };
}

export default function SkyPreview({ value, onChange, onClose, hidePage, onHidePage }) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => onChange((v) => step(v)), 3500);
    return () => clearInterval(t);
  }, [playing, onChange]);
  const t = TIMES.find((x) => x[0] === value.time) || TIMES[0];
  const day = value.time !== 'night';

  return (
    <div className="lw-glass lw-preview" role="dialog" aria-label="Sky preview">
      <div className="lw-title"><Palette />Sky preview<span className="lw-title-aside">
        <button type="button" className="lw-icon-btn" style={{ width: 28, height: 28 }} onClick={onClose} aria-label="Close the sky preview"><X size={14} /></button>
      </span></div>

      <div className="lw-preview-now">
        <WxIcon cond={value.cond} day={day} size={40} />
        <div><b>{condLabel(value.cond, day)}</b><span>{t[1]} · wind {value.wind} mph</span></div>
      </div>

      <div className="lw-seg" role="group" aria-label="Time of day" style={{ display: 'flex', marginBottom: 10 }}>
        {TIMES.map(([k, l]) => <button key={k} type="button" style={{ flex: 1 }} aria-pressed={value.time === k} onClick={() => { setPlaying(false); onChange((v) => ({ ...v, time: k })); }}>{l}</button>)}
      </div>

      <div className="lw-preview-grid" role="group" aria-label="Weather">
        {CONDS.map((c) => (
          <button key={c} type="button" className="lw-chip" aria-pressed={value.cond === c} onClick={() => { setPlaying(false); onChange((v) => ({ ...v, cond: c })); }}>
            <WxIcon cond={c} day={day} size={20} />{condLabel(c, day)}
          </button>
        ))}
      </div>

      <label className="lw-preview-wind">
        <span>Wind</span>
        <input type="range" min="0" max="60" step="2" value={value.wind} onChange={(e) => onChange((v) => ({ ...v, wind: Number(e.target.value) }))} />
        <b>{value.wind} mph</b>
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="lw-chip" aria-pressed={hidePage} onClick={() => onHidePage(!hidePage)}>
          {hidePage ? <Eye size={14} /> : <EyeOff size={14} />}{hidePage ? 'Show the page' : 'Hide the page'}
        </button>
        <button type="button" className="lw-chip" aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>
          {playing ? <Pause size={14} /> : <Play size={14} />}{playing ? 'Stop' : 'Play through all'}
        </button>
      </div>
    </div>
  );
}
