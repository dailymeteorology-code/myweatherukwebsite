/* The thunderstorm risk at the place, hour by hour, from MyWeatherUK's own TCM NOVA model
   (server/novaPoint.js): its Hyper-Short nowcast for the next few hours, then its Main Run.

   A bar per hour for the next two days, coloured by NOVA's risk bands (Low, Marginal, Slight,
   Enhanced, Moderate, High: the TCM NOVA page's TSTM to HIGH), the riskiest hour of each day
   after that, and the source said plainly: NOVA's, not the Met Office's. */
import React, { useRef, useState } from 'react';
import { CloudLightning, Zap } from 'lucide-react';
import { THUNDER_LEVELS, thunderRisk, hhmm, hourOf, ukDay, dayLabel } from '@/lib/ukvLocation';

const runHour = (iso) => (iso ? `${String(new Date(iso).getUTCHours()).padStart(2, '0')}Z` : '');
const pct = (p) => (p < 1 ? '<1%' : `${Math.round(p)}%`);
/* "16:00", "16:00 tomorrow", "16:00 Sat" */
const when = (t) => {
  const label = dayLabel(ukDay(t));
  return label === 'Today' ? hhmm(t) : `${hhmm(t)} ${label === 'Tomorrow' ? 'tomorrow' : label}`;
};

/** One sentence for the next 24 hours. */
function headline(hs) {
  const next = hs.filter((h) => h.t <= Date.now() + 24 * 3600e3);
  if (!next.length) return '';
  const peak = next.reduce((a, b) => (b.p > a.p ? b : a));
  const lv = thunderRisk(peak.p);
  if (!lv) return 'No thunderstorms expected in the next 24 hours.';
  const on = next.filter((h) => h.p >= 2);
  const from = on[0], to = on[on.length - 1];
  /* the day said once: "from about 10:00 to 14:00 tomorrow, highest around 12:00 at 6%" */
  const sameDay = ukDay(from.t) === ukDay(to.t);
  const span = from.t === to.t ? `around ${when(peak.t)}`
    : sameDay ? `from about ${hhmm(from.t)} to ${when(to.t)}` : `from about ${when(from.t)} to ${when(to.t)}`;
  const peakAt = sameDay ? hhmm(peak.t) : when(peak.t);
  return lv.key === 'TSTM'
    ? `A low risk of a thunderstorm ${span}, at most ${pct(peak.p)}.`
    : `A ${lv.word.toLowerCase()} risk of thunderstorms ${span}${from.t === to.t ? '' : `, highest around ${peakAt}`} at ${pct(peak.p)}.`;
}

export default function LocationThunder({ model }) {
  const nova = model.nova;
  const [hover, setHover] = useState(null);
  const barsRef = useRef(null);
  if (!nova?.hours?.length) return null;
  const start = Math.floor(Date.now() / 3600e3) * 3600e3;
  const hs = nova.hours.filter((h) => h.t >= start).slice(0, 48);
  if (!hs.length) return null;
  const top = Math.max(20, ...hs.map((h) => h.p * 1.15));               // the scale: at least to Slight
  const guides = THUNDER_LEVELS.filter((l) => l.min >= 5 && l.min < top).reverse();
  const byDay = model.days.filter((d) => d.thunderPeak);
  const pick = (e) => {
    const r = barsRef.current?.getBoundingClientRect();
    if (r) setHover(Math.max(0, Math.min(hs.length - 1, Math.floor(((e.clientX - r.left) / r.width) * hs.length))));
  };
  const hh = hover != null ? hs[hover] : null;
  const hlv = hh && thunderRisk(hh.p);

  return (
    <div className="lw-glass lw-card lw-thunder">
      <div className="lw-title">
        <CloudLightning />Thunderstorm risk
        <span className="lw-nova-badge" title="MyWeatherUK's own thunderstorm model"><Zap size={11} strokeWidth={2.6} />TCM NOVA</span>
      </div>
      <p className="lw-summary lw-psum">{headline(hs)}</p>
      <div className="lw-pchart lw-tchart" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}
        role="img" aria-label={`Thunderstorm risk each hour for the next ${hs.length} hours, from TCM NOVA. ${headline(hs)}`}>
        {guides.map((l) => (
          <React.Fragment key={l.key}>
            <i className="lw-pguide" style={{ bottom: `${(l.min / top) * 100}%`, borderTopColor: `${l.colour}66` }} />
            <span className="lw-pband" style={{ bottom: `${(l.min / top) * 100}%`, transform: 'translateY(50%)', color: l.colour }}>{l.word}</span>
          </React.Fragment>
        ))}
        <div className="lw-pbars lw-tbars" ref={barsRef}>
          {hs.map((h, k) => {
            const lv = thunderRisk(h.p);
            const newDay = k > 0 && hourOf(h.t) === 0;
            return (
              <i key={h.t} className={`${lv ? '' : 'is-dry'}${hover === k ? ' is-on' : ''}${newDay ? ' is-day' : ''}`}
                style={{ height: `${Math.max(lv ? 4 : 1.5, (h.p / top) * 100)}%`, ...(lv ? { background: `linear-gradient(180deg, ${lv.colour}, ${lv.colour}aa)` } : {}) }} />
            );
          })}
          {hover != null && <b className="lw-pcursor" style={{ left: `${((hover + 0.5) / hs.length) * 100}%` }} />}
        </div>
      </div>
      <div className="lw-paxis lw-taxis">
        {hs.map((h, k) => (k % 6 === 0 ? (
          <span key={h.t} style={{ left: `${((k + 0.5) / hs.length) * 100}%` }}>
            {k === 0 ? 'Now' : hourOf(h.t) === 0 ? new Date(h.t).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Europe/London' }) : String(hourOf(h.t)).padStart(2, '0')}
          </span>
        ) : null))}
      </div>
      <p className="lw-pnote">
        {hh ? <><b>{when(hh.t)}</b> · {pct(hh.p)} chance of a thunderstorm within about {hh.nb} km{hlv ? ` · ${hlv.word} risk` : ''} · {hh.src === 'hyper' ? 'Hyper-Short nowcast' : hh.src === 'blend' ? 'nowcast handing over to the Main Run' : 'Main Run'}</>
          : 'The chance of a thunderstorm near here each hour. Hover over the bars for an hour.'}
      </p>
      {byDay.length > 1 && (
        <div className="lw-tdays" aria-label="The riskiest hour of each day">
          {byDay.map((d) => {
            const lv = thunderRisk(d.thunderPeak.p);
            return (
              <span key={d.day} className="lw-day-fact" style={lv ? { boxShadow: `inset 0 0 0 1.5px ${lv.colour}` } : undefined}>
                <b>{d.label}</b>{lv ? <><i style={{ background: lv.colour }} />{lv.word} · {pct(d.thunderPeak.p)}</> : 'No risk'}
              </span>
            );
          })}
        </div>
      )}
      <div className="lw-tlegend">
        {[...THUNDER_LEVELS].reverse().map((l) => <span key={l.key}><i style={{ background: l.colour }} />{l.word} {l.min}%+</span>)}
      </div>
      <p className="lw-nova-note">
        <Zap size={12} strokeWidth={2.6} />
        <span>
          Thunderstorm risk comes from <b>MyWeatherUK&rsquo;s own TCM NOVA model</b>: its Hyper-Short nowcast of the radar and lightning
          {nova.runs?.hyper ? ` (run ${runHour(nova.runs.hyper.run)})` : ''} for the next few hours, then its Main Run, seven forecast models through TCM V5 at 2 km
          {nova.runs?.main ? ` (run ${runHour(nova.runs.main.run)})` : ''}. NOVA is still learning: its chances are not yet calibrated against observed storms.
        </span>
      </p>
    </div>
  );
}
