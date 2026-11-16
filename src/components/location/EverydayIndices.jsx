/* Out and about (Location Weather, 16 Nov 2026, at the user's request): how good each of the next 48
   hours is for washing on the line, a BBQ, a dog walk, a run or a ride (with the headwind for the way you
   are going), the best spells in words; and, when they matter, tonight's garden frost, a school snow-day
   chance, heat or cold stress, and what solar panels and wind turbines would make. All from this place's
   own forecast (lib/everydayIndices). */
import React, { useMemo, useState } from 'react';
import { Footprints } from 'lucide-react';
import { useUnits } from '@/components/useUnits';
import { hhmm } from '@/lib/ukvLocation';
import { ACTIVITIES, energy, frostAlert, goodSpells, headwind, scoreHours, snowDays, stress } from '@/lib/everydayIndices';

const HEADINGS = [[0, 'north'], [45, 'north-east'], [90, 'east'], [135, 'south-east'], [180, 'south'], [225, 'south-west'], [270, 'west'], [315, 'north-west']];
const dayWord = (ms, now = Date.now()) => {
  const f = (x) => new Date(x).toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
  if (f(ms) === f(now)) return 'today';
  if (f(ms) === f(now + 86400e3)) return 'tomorrow';
  return new Date(ms).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long' });
};
const shade = (s) => (s >= 0.8 ? '#22c55e' : s >= 0.6 ? '#84cc16' : s >= 0.4 ? '#facc15' : s >= 0.2 ? '#fb923c' : '#94a3b8');

export default function EverydayIndices({ model }) {
  const U = useUnits();
  const [act, setAct] = useState('washing');
  const [heading, setHeading] = useState(0);
  const now = Date.now();
  const hours = useMemo(() => (model?.hours || []).filter((h) => h.t >= now - 3600e3 && h.t <= now + 48 * 3600e3), [model]);   // eslint-disable-line react-hooks/exhaustive-deps
  const scored = useMemo(() => scoreHours(hours, act, { heading }), [hours, act, heading]);
  const spells = useMemo(() => goodSpells(scored).slice(0, 3), [scored]);
  const frost = useMemo(() => frostAlert(model?.hours, now), [model]);                 // eslint-disable-line react-hooks/exhaustive-deps
  const snow = useMemo(() => snowDays((model?.hours || []).filter((h) => h.t >= now - 3600e3)), [model]);   // eslint-disable-line react-hooks/exhaustive-deps
  const heat = useMemo(() => stress(hours), [hours]);
  const power = useMemo(() => energy((model?.hours || []).filter((h) => h.t >= now - 12 * 3600e3)), [model]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!hours.length) return null;
  const label = ACTIVITIES.find(([k]) => k === act)?.[1] || '';
  const deg = (c) => U.fmtTemp(c);
  const hwNow = act === 'cycle' && hours[0] ? headwind(hours[0], heading) : null;
  const worst = scored.filter((x) => x.why).map((x) => x.why);
  const why = worst.length ? [...new Set(worst)].slice(0, 2).join(', ') : null;
  return (
    <div className="lw-glass lw-card lw-sit">
      <div className="lw-title"><Footprints />Out and about<span className="lw-title-aside">Next 48 hours</span></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', margin: '2px 0 8px' }}>
        <div className="lw-seg lw-seg-sm" role="group" aria-label="What for" style={{ flexWrap: 'wrap' }}>
          {ACTIVITIES.map(([k, l]) => <button key={k} type="button" aria-pressed={act === k} onClick={() => setAct(k)}>{l}</button>)}
        </div>
        {act === 'cycle' && (
          <select value={heading} onChange={(e) => setHeading(Number(e.target.value))} aria-label="Which way you are riding"
            style={{ border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, padding: '4px 8px', fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.12)', color: 'var(--ink)' }}>
            {HEADINGS.map(([d, l]) => <option key={d} value={d} style={{ color: '#111' }}>Riding {l}</option>)}
          </select>
        )}
      </div>
      <div className="lw-sit-row">
        <p className="lw-sit-head">
          {spells.length
            ? <>{label}: best {spells.map((s, i) => <span key={s.from}>{i ? (i === spells.length - 1 ? ' and ' : ', ') : ''}<b>{dayWord(s.from)} {hhmm(s.from)}–{hhmm(s.to + 3600e3)}</b></span>)}.</>
            : <>{label}: no good spell in the next two days{why ? ` (${why})` : ''}.</>}
        </p>
        {act === 'cycle' && hwNow != null && (
          <p className="lw-sit-sub">Now, riding {HEADINGS.find(([d]) => d === heading)?.[1]}: {Math.abs(hwNow) < 2 ? 'little wind against you or behind you' : hwNow > 0 ? `a headwind of about ${U.fmtWind(hwNow)}` : `a tailwind of about ${U.fmtWind(-hwNow)}`}.</p>
        )}
        <div className="lw-strip-wrap" role="img" aria-label={`How good each hour is for ${label.toLowerCase()}`}>
          <div className="lw-strip">
            {scored.map((x) => <i key={x.t} style={{ background: shade(x.score) }} title={`${hhmm(x.t)}: ${Math.round(x.score * 10)}/10${x.why ? ` (${x.why})` : ''}`} />)}
          </div>
          <div className="lw-strip-ticks">
            {scored.map((x, i) => (new Date(x.t).getUTCHours() % 6 === 0 ? <span key={x.t} style={{ left: `${((i + 0.5) / scored.length) * 100}%` }}>{hhmm(x.t)}</span> : null))}
          </div>
        </div>
        <div className="lw-sit-key"><i style={{ background: '#22c55e' }} />Ideal<i style={{ background: '#84cc16' }} />Good<i style={{ background: '#facc15' }} />Fair<i style={{ background: '#fb923c' }} />Poor<i style={{ background: '#94a3b8' }} />No</div>
      </div>
      {frost && (
        <div className="lw-sit-row">
          <p className="lw-sit-head">{frost.level === 'air' ? <b>An air frost tonight</b> : <b>A ground frost tonight</b>}: protect tender plants and cover the car.</p>
          <p className="lw-sit-sub">The air gets down to {deg(frost.air.t2)} about {hhmm(frost.air.t)}{frost.ground?.ground != null ? `, the ground to ${deg(frost.ground.ground)}` : ''}{frost.clear ? ', under a clear sky' : ''}.</p>
        </div>
      )}
      {snow.map((s) => (
        <div key={s.day} className="lw-sit-row">
          <p className="lw-sit-head">School snow day {dayWord(Date.parse(`${s.day}T08:00:00Z`))}: <b>{s.level}</b> chance.</p>
          <p className="lw-sit-sub">About {s.fresh} cm of fresh snow by the morning{s.lying ? `, ${s.lying} cm lying` : ''}{s.t8 != null ? `, ${deg(s.t8)} at 8 am` : ''}. A rough guide only: schools decide.</p>
        </div>
      ))}
      {heat.map((s) => (
        <div key={s.day} className="lw-sit-row">
          {s.heat && <p className="lw-sit-head"><b>{s.heat} heat stress</b> {dayWord(s.hot.t)}: it feels like {deg(s.hot.feels)} about {hhmm(s.hot.t)}. Drink plenty and keep out of the midday sun.</p>}
          {s.chill && <p className="lw-sit-head"><b>{s.chill} cold stress</b> {dayWord(s.cold.t)}: it feels like {deg(s.cold.feels)} about {hhmm(s.cold.t)}. Wrap up, and cover hands and face.</p>}
        </div>
      ))}
      {power.length > 0 && (
        <div className="lw-sit-row">
          <p className="lw-sit-sub">
            {(() => {
              const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
              const when = (p) => { const w = dayWord(Date.parse(`${p.day}T12:00:00Z`)); return w === 'today' || w === 'tomorrow' ? w : `on ${w}`; };
              const sun = power.map((p, i) => (i ? `${p.kwh} ${when(p)}` : `${p.kwh} kWh for each kWp of panels ${when(p)}`));
              const wind = power.filter((p) => p.wind != null).map((p, i) => (i ? `${p.wind}% ${when(p)}` : `${p.wind}% of their rating ${when(p)}`));
              return `Solar panels: about ${list(sun)}.${wind.length ? ` Wind turbines: running at about ${list(wind)}.` : ''}`;
            })()}
          </p>
        </div>
      )}
    </div>
  );
}
