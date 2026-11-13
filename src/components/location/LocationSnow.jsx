/* The snow risk at the place for the next ten days, from MyWeatherUK's own snow model, TCM FROST
   (server/tcmFrost.js): every forecast of eight models and their ensembles brought down to 2 km and
   blended, run every six hours.

   A bar for each period (three hours for five days, then six), as tall as the chance of snow
   falling in it and coloured by the snow risk of the 24 hours to its end; then each day: its risk,
   the snow expected and the chance of a centimetre or more. Amounts are fresh snow falling, not
   the depth lying. Out of the snow season, with no snow anywhere in sight, the card stays away. */
import React, { useRef, useState } from 'react';
import { Snowflake } from 'lucide-react';
import { hhmm, hourOf, ukDay, dayLabel } from '@/lib/ukvLocation';
import { SNOW_RISK_LEVELS, snowRiskLevel, cmText } from '@/lib/frostKey';

const H = 3600e3;
const runHour = (iso) => (iso ? `${String(new Date(iso).getUTCHours()).padStart(2, '0')}Z` : '');
const pct = (p) => (p < 1 ? '<1%' : `${Math.round(p)}%`);
/* "Today", "Tomorrow", "Sat", and the date as well from a week out, where weekdays repeat */
function dayName(day, today) {
  const ahead = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5);
  const l = dayLabel(day, today);
  return ahead >= 6 ? `${l} ${Number(day.slice(8))}` : l;
}
/* "today", "tomorrow", "on Sunday", and "on Thursday 19th"-style from a week out, said in full */
const onDay = (day, today) => {
  const l = dayName(day, today);
  if (l === 'Today' || l === 'Tomorrow') return l.toLowerCase();
  const d = Number(day.slice(8));
  const th = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th';
  const wd = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  return /\d/.test(l) ? `on ${wd} ${d}${th}` : `on ${wd}`;
};

/** One sentence for the ten days. */
function headline(days, today) {
  if (!days.length) return '';
  const worst = days.reduce((a, b) => (b.risk > a.risk || (b.risk === a.risk && b.p1 > a.p1) ? b : a));
  if (worst.risk >= 1) {
    const lv = snowRiskLevel(worst.risk);
    const others = days.filter((d) => d.risk >= 1 && d !== worst).length;
    const amount = worst.p1 >= 10 ? `a ${pct(worst.p1)} chance of 1 cm or more` : `a ${pct(worst.p0)} chance of a dusting`;
    const big = worst.p5 >= 10 ? `, ${pct(worst.p5)} of 5 cm` : '';
    const expect = worst.cm >= 0.2 ? ` (${cmText(worst.cm)} expected)` : '';
    return `A ${lv.name.toLowerCase()} risk of snow ${onDay(worst.date, today)}: ${amount}${big}${expect}.${others ? ` ${others === 1 ? 'One other day has' : `${others} other days have`} a risk too.` : ''}`;
  }
  const any = days.reduce((a, b) => (b.p0 > a.p0 ? b : a));
  return any.p0 >= 5 ? `Little chance of snow: at most ${pct(any.p0)} for a dusting ${onDay(any.date, today)}.` : 'No snow expected in the next ten days.';
}

export default function LocationSnow({ model }) {
  const fr = model.frost;
  const [hover, setHover] = useState(null);
  const barsRef = useRef(null);
  if (!fr?.steps?.length) return null;
  const now = Date.now(), today = ukDay(now);
  const run0 = Date.parse(fr.run);
  /* each period: from the step before (or the run's start) to its own time */
  const periods = fr.steps.map((s, k) => ({ ...s, t: Date.parse(s.valid), t0: k ? Date.parse(fr.steps[k - 1].valid) : run0 }))
    .filter((p) => p.t > now);
  const days = (fr.days || []).filter((d) => d.date >= today);
  const signal = days.some((d) => d.risk >= 1 || d.p0 >= 5) || periods.some((p) => p.chance >= 5);
  const month = Number(today.slice(5, 7));
  if (!periods.length || (!signal && month >= 5 && month <= 9)) return null;

  const t0 = Math.max(periods[0].t0, now), t1 = periods[periods.length - 1].t, span = t1 - t0;
  const top = Math.max(30, ...periods.map((p) => p.chance * 1.12));
  const pick = (e) => {
    const r = barsRef.current?.getBoundingClientRect();
    if (!r) return;
    const t = t0 + ((e.clientX - r.left) / r.width) * span;
    const k = periods.findIndex((p) => p.t >= t);
    setHover(k < 0 ? periods.length - 1 : k);
  };
  const hp = hover != null ? periods[hover] : null;
  const hlv = hp && snowRiskLevel(hp.risk);
  const ticks = [];
  for (let d = ukDay(t0 + 12 * H); ; ) {
    const ms = Date.parse(`${d}T00:00:00Z`);
    const at = ms - (hourOf(ms) || 0) * H;                    // London midnight (in BST, 23Z the day before)
    if (at > t1) break;
    if (at > t0 + 2 * H) ticks.push({ at, label: dayName(d, today) });
    d = new Date(Date.parse(`${d}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
  }
  const head = headline(days, today);

  return (
    <div className="lw-glass lw-card lw-snow">
      <div className="lw-title">
        <Snowflake />Snow risk
        <span className="lw-frost-badge" title="MyWeatherUK's own snow model"><Snowflake size={11} strokeWidth={2.6} />TCM FROST</span>
      </div>
      <p className="lw-summary lw-psum">{head}</p>
      {signal && (
        <>
          <div className="lw-pchart lw-schart" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}
            role="img" aria-label={`The chance of snow falling here in each period for the next ten days, from TCM FROST. ${head}`}>
            {[25, 50, 75].filter((v) => v < top).map((v) => (
              <React.Fragment key={v}>
                <i className="lw-pguide" style={{ bottom: `${(v / top) * 100}%` }} />
                <span className="lw-pband" style={{ bottom: `${(v / top) * 100}%` }}>{v}%</span>
              </React.Fragment>
            ))}
            <div className="lw-pbars lw-sbars" ref={barsRef}>
              {periods.map((p, k) => {
                const lv = snowRiskLevel(p.risk);
                const w = (Math.min(p.t, t1) - Math.max(p.t0, t0)) / H;
                return (
                  <i key={p.lead} className={`${p.chance >= 1 ? '' : 'is-dry'}${hover === k ? ' is-on' : ''}`}
                    style={{ flex: `${Math.max(0.5, w)} 1 0`, height: `${Math.max(p.chance >= 1 ? 3 : 1.5, (p.chance / top) * 100)}%`,
                      background: lv ? `linear-gradient(180deg, ${lv.colour}, ${lv.colour}99)` : p.chance >= 1 ? 'linear-gradient(180deg, #ffffff, #c9dbef)' : undefined }} />
                );
              })}
              {ticks.map((x) => <b key={x.at} className="lw-sday" style={{ left: `${((x.at - t0) / span) * 100}%` }} />)}
              {hp && <b className="lw-pcursor" style={{ left: `${(((Math.max(hp.t0, t0) + hp.t) / 2 - t0) / span) * 100}%` }} />}
            </div>
          </div>
          <div className="lw-paxis lw-saxis">
            <span style={{ left: 0, transform: 'none' }}>Now</span>
            {ticks.map((x) => ((x.at - t0) / span < 0.05 ? null : <span key={x.at} style={{ left: `${((x.at - t0) / span) * 100}%` }}>{x.label}</span>))}
          </div>
          <p className="lw-pnote">
            {hp ? (
              <><b>{dayName(ukDay(hp.t0 + 60e3), today)} {hhmm(Math.max(hp.t0, run0))}–{hhmm(hp.t)}</b> · {pct(hp.chance)} chance of snow falling
                {hp.acc_cm >= 0.2 ? ` · ${cmText(hp.acc_cm)} expected by then` : ''}{hlv ? ` · ${hlv.name} risk over the 24 hours to then` : ''}</>
            ) : 'The chance of snow falling here in each period, coloured by the snow risk. Hover over the bars for one.'}
          </p>
        </>
      )}
      {days.length > 0 && signal && (
        <div className="lw-tdays lw-sdays" aria-label="Each day's snow">
          {days.map((d) => {
            const lv = snowRiskLevel(d.risk);
            const tip = `${dayName(d.date, today)}: ${lv ? `${lv.name} risk. ` : ''}${cmText(d.cm)} expected; chance of a dusting ${pct(d.p0)}, 1 cm ${pct(d.p1)}, 5 cm ${pct(d.p5)}, 10 cm ${pct(d.p10)}`;
            return (
              <span key={d.date} className="lw-day-fact" title={tip} style={lv ? { boxShadow: `inset 0 0 0 1.5px ${lv.colour}` } : undefined}>
                <b>{dayName(d.date, today)}</b>
                {lv ? <><i style={{ background: lv.colour }} />{lv.name}{d.cm >= 0.2 ? ` · ${cmText(d.cm)}` : ''}</> : d.p0 >= 5 ? `${pct(d.p0)} chance` : 'None'}
              </span>
            );
          })}
        </div>
      )}
      {signal && (
        <div className="lw-tlegend">
          {[...SNOW_RISK_LEVELS].reverse().map((l) => <span key={l.level} title={`${l.rule} in 24 hours`}><i style={{ background: l.colour }} />{l.name}: {l.rule}</span>)}
        </div>
      )}
      <p className="lw-nova-note lw-frost-note">
        <Snowflake size={12} strokeWidth={2.6} />
        <span>
          Snow risk comes from <b>MyWeatherUK&rsquo;s own TCM FROST model</b>: {fr.members ? `${fr.members} forecasts` : 'every forecast'} from the Met Office UKV and Global,
          ECMWF&rsquo;s IFS and AIFS, NOAA&rsquo;s GFS and the ECMWF and NOAA ensembles, each brought down to 2 km over the hills and blended
          (run {runHour(fr.run)}). Amounts are fresh snow falling, not the depth lying.
        </span>
      </p>
    </div>
  );
}
