/* Situation cards (Location Weather, 15 Nov 2026, Phase B): road ice and fog, whether the snow will
   settle, the night sky (stargazing, the aurora, meteor showers) and the weather for event days and
   bank holidays. Each shows only when it has something to say (src/lib/location/situations.js), so on a
   quiet day none of them takes any room. */
import React, { useEffect, useMemo, useState } from 'react';
import { Car, CloudFog, Snowflake, Telescope, CalendarDays, Sparkles } from 'lucide-react';
import { useUnits } from '@/components/useUnits';
import { hhmm, hourOf } from '@/lib/ukvLocation';
import { roadIce, fogSpells, snowSettle, nightSky, eventsAhead, when } from '@/lib/location/situations';
import { fetchKp, fetchBankHolidays } from '@/lib/location/feeds';
import { ChangesCard } from '@/components/location/StormWatch';

/* the next hours as a strip of cells, coloured by level, with the time every six hours under it */
function Strip({ cells, colours, label }) {
  const n = cells.length;
  return (
    <div className="lw-strip-wrap" role="img" aria-label={label}>
      <div className="lw-strip">
        {cells.map((c) => <i key={c.t} style={c.level ? { background: colours[c.level] } : undefined} title={`${hhmm(c.t)}`} />)}
      </div>
      <div className="lw-strip-ticks">
        {cells.map((c, i) => (hourOf(c.t) % 6 === 0 ? <span key={c.t} style={{ left: `${((i + 0.5) / n) * 100}%` }}>{hhmm(c.t)}</span> : null))}
      </div>
    </div>
  );
}

/* ── road ice and fog: one card, a row for each that matters ── */
export function RoadsCard({ model }) {
  const U = useUnits();
  const ice = useMemo(() => roadIce(model), [model]);
  const fog = useMemo(() => fogSpells(model), [model]);
  if (!ice && !fog) return null;
  const deg = (c) => `${Math.round(U.temp(c))}${U.tempUnit}`;
  return (
    <div id="lw-card-roads" className="lw-glass lw-card lw-sit">
      <div className="lw-title">{ice ? <Car /> : <CloudFog />}{ice && fog ? 'Road ice and fog' : ice ? 'Road ice' : 'Fog'}<span className="lw-title-aside">Next 36 hours</span></div>
      {ice && (
        <div className="lw-sit-row">
          <p className="lw-sit-head">{ice.headline}.</p>
          <p className="lw-sit-sub">The ground gets down to {deg(ice.cold.v)} around {when(ice.cold.t)}. Treated main roads are usually clear; take care on paths, bridges and side roads.</p>
          <Strip cells={ice.cells} colours={{ 1: '#9fd8ff', 2: '#3d9bff' }} label={ice.headline} />
          <div className="lw-sit-key"><i style={{ background: '#9fd8ff' }} />Frost or ice possible<i style={{ background: '#3d9bff' }} />Icy stretches likely</div>
        </div>
      )}
      {fog && (
        <div className="lw-sit-row">
          <p className="lw-sit-head">{fog.headline}.</p>
          <Strip cells={fog.cells} colours={{ 1: '#c9ced6', 2: '#8a93a1' }} label={fog.headline} />
          <div className="lw-sit-key"><i style={{ background: '#c9ced6' }} />Fog, under 1 km<i style={{ background: '#8a93a1' }} />Dense fog, under 200 m</div>
        </div>
      )}
    </div>
  );
}

/* ── will the snow settle? ── */
const VERDICT = { Likely: '#c450cf', Possible: '#f8d2f4', Unlikely: 'rgba(255,255,255,0.25)' };
export function SettleCard({ model }) {
  const s = useMemo(() => snowSettle(model), [model]);
  if (!s) return null;
  return (
    <div id="lw-card-settle" className="lw-glass lw-card lw-sit">
      <div className="lw-title"><Snowflake />Will the snow settle?
        <span className="lw-title-aside"><b className="lw-badge" style={{ background: VERDICT[s.verdict], color: s.verdict === 'Likely' ? '#fff' : '#0b1a2c' }}>{s.verdict}</b></span>
      </div>
      <p className="lw-sit-head">{s.headline}.</p>
      <p className="lw-sit-sub">
        {s.lying >= 1 ? `Lying now: about ${Math.round(s.lying)} cm. ` : ''}
        {s.sledge ? `Deep enough for sledging from ${when(s.sledge)}. ` : ''}
        Snow settles on ground at or below freezing; on milder ground it needs to fall hard. Depths at 10 cm of snow for every 1 cm of rain, from the UKV.
      </p>
    </div>
  );
}

/* ── the night sky ── */
export function NightSkyCard({ model }) {
  const [kp, setKp] = useState(null);
  useEffect(() => { let on = true; fetchKp().then((k) => { if (on) setKp(k); }); return () => { on = false; }; }, []);
  const sky = useMemo(() => nightSky(model, kp), [model, kp]);
  if (!sky) return null;
  return (
    <div id="lw-card-nightsky" className="lw-glass lw-card lw-sit">
      <div className="lw-title"><Telescope />The night sky<span className="lw-title-aside">Stars, aurora, meteors</span></div>
      <div className="lw-night">
        {sky.nights.map((n) => (
          <div key={n.day} className="lw-night-row">
            <div className="lw-night-top">
              <b>{n.label}</b>
              <span className={`lw-night-word is-${n.word.toLowerCase()}`}>{n.word} for stargazing</span>
              <span className="lw-night-score" aria-label={`${n.score} out of 10`}><i style={{ width: `${n.score * 10}%` }} /></span>
            </div>
            <p className="lw-sit-sub">
              {Math.round(n.cloud)}% cloud through the dark hours{n.best ? `, clearest ${hhmm(n.best.from)}–${hhmm(n.best.to)}` : ''}. {n.moon.name}, {Math.round(n.moon.lit * 100)}% lit.
            </p>
            {n.showers.map((s) => (
              <p key={s.name} className="lw-sit-note"><Sparkles size={13} />The {s.name} peak: up to {s.zhr} meteors an hour under a dark sky{n.score >= 6 ? ', and the sky looks good for them' : ''}.</p>
            ))}
            {n.aurora && (
              <p className="lw-sit-note is-aurora"><Sparkles size={13} />Aurora: {n.aurora.toLowerCase()} (Kp up to {n.kpMax.toFixed(1)}; here it needs about {n.kpNeed.toFixed(1)}). Look north, away from lights.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── event days and bank holidays in the forecast ── */
export function EventsCard({ model }) {
  const U = useUnits();
  const [bank, setBank] = useState(null);
  useEffect(() => { let on = true; fetchBankHolidays().then((b) => { if (on) setBank(b); }); return () => { on = false; }; }, []);
  const ev = useMemo(() => eventsAhead(model, bank), [model, bank]);
  if (!ev) return null;
  const deg = (c) => `${Math.round(U.temp(c))}${U.tempUnit}`;
  return (
    <div id="lw-card-events" className="lw-glass lw-card lw-sit">
      <div className="lw-title"><CalendarDays />Days to plan for</div>
      {ev.map((e) => (
        <div key={e.day} className="lw-sit-row">
          <p className="lw-sit-head"><b>{e.name}</b> · {e.label} {e.date}</p>
          <p className="lw-sit-sub">
            {[e.cond, e.evening ? (e.lo != null ? `around ${deg(e.lo)} in the evening` : null) : (e.hi != null ? `highs of ${deg(e.hi)}` : null),
              e.pRain != null ? `${e.pRain}% chance of rain` : null, (e.gust ?? 0) >= 35 ? `gusts ${U.fmtWind(e.gust)}` : null,
              e.dry != null && e.evening ? (e.dry ? 'dry through the evening' : 'some rain in the evening') : null].filter(Boolean).join(', ')}.
            {e.white ? ` ${e.white}.` : ''}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function SituationCards({ model }) {
  return (
    <>
      <RoadsCard model={model} />
      <SettleCard model={model} />
      <ChangesCard model={model} />
      <NightSkyCard model={model} />
      <EventsCard model={model} />
    </>
  );
}
