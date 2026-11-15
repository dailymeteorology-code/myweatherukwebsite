/* Storm watch and "Since the last run" (Location Weather, 15 Nov 2026, Phase C).

   Storm watch, only when there is something to watch:
     • an AI lightning warning over the place, heading for it, or nearby (MyWeatherUK's AIW, /api/aiw/check)
     • lightning within 60 km in the last hour, on a little map round the place, and whether it is
       coming closer (the Met Office's strikes over the UK, Blitzortung beyond)
     • the heaviest rain coming this way and when it gets here (the radar and the rain's own motion)
     • the storms the atmosphere favours and the hail they could bring (CAPE from the UKV, wind shear now
       from the GFS)
   It looks again every minute while the page is open.

   Since the last run: the newest UKV run here against the one before it, in a few lines. */
import React, { useEffect, useMemo, useState } from 'react';
import { CloudLightning, Zap, CloudRain, History, ShieldAlert } from 'lucide-react';
import { useUnits } from '@/components/useUnits';
import { hhmm, thunderRisk } from '@/lib/ukvLocation';
import { lightningNear, stormNear, aiwCheck, runChanges, lightningSummary, stormType, hailSize, changeWords, dir8, when } from '@/lib/location/storm';

/* a feed, read now and every minute while the page is in view; a failed read keeps the last answer */
function usePoll(read, deps, everyMs = 60e3) {
  const [v, setV] = useState(null);
  useEffect(() => {
    let alive = true, ac = null;
    const go = () => {
      if (document.hidden) return;
      ac?.abort(); ac = new AbortController();
      read(ac.signal).then((x) => { if (alive) setV(x); }).catch(() => {});
    };
    go();
    const id = setInterval(go, everyMs);
    const vis = () => { if (!document.hidden) go(); };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; ac?.abort(); clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

/* the strikes round the place: rings at 10, 20, 40 and 60 km, the newest brightest */
const AGE_COLOURS = [[10, '#fff36b'], [20, '#ffc04d'], [40, '#ff8a5c'], [61, '#c96b8a']];
function StrikeMap({ strikes, R = 60 }) {
  const S = 168, c = S / 2, r = S / 2 - 12;
  return (
    <svg className="lw-strikes" width={S} height={S} viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Lightning round this place in the last hour">
      {[10, 20, 40, 60].map((k) => (
        <g key={k}>
          <circle cx={c} cy={c} r={(k / R) * r} fill="none" stroke="rgba(255,255,255,0.16)" strokeDasharray={k === 10 ? '3 3' : undefined} />
          <text x={c + 3} y={c - (k / R) * r + 10} fontSize="9" fill="rgba(255,255,255,0.45)">{k}</text>
        </g>
      ))}
      {['N', 'E', 'S', 'W'].map((d, i) => (
        <text key={d} x={c + Math.sin((i * Math.PI) / 2) * (r + 7)} y={c - Math.cos((i * Math.PI) / 2) * (r + 7) + 3} fontSize="9.5" fontWeight="700" textAnchor="middle" fill="rgba(255,255,255,0.55)">{d}</text>
      ))}
      {[...strikes].reverse().map(([ago, km, b], i) => {
        const rr = (Math.min(km, R) / R) * r, a = (b * Math.PI) / 180;
        const col = (AGE_COLOURS.find(([m]) => ago < m) || AGE_COLOURS[3])[1];
        return <circle key={i} cx={c + Math.sin(a) * rr} cy={c - Math.cos(a) * rr} r={ago < 10 ? 2.6 : 2} fill={col} opacity={ago < 10 ? 1 : 0.8} />;
      })}
      <circle cx={c} cy={c} r="3.5" fill="#fff" stroke="#0b1a2c" strokeWidth="1.5" />
    </svg>
  );
}

export function StormWatch({ model }) {
  const U = useUnits();
  const { lat, lon } = model;
  const ltg = usePoll((s) => lightningNear(lat, lon, s), [lat, lon]);
  const storm = usePoll((s) => stormNear(lat, lon, s), [lat, lon]);
  const aiw = usePoll((s) => aiwCheck(lat, lon, s), [lat, lon]);
  const L = useMemo(() => lightningSummary(ltg), [ltg]);

  /* the storm environment: the UKV's CAPE over the next day, at its peak, with the NOVA risk */
  const env = useMemo(() => {
    const now = Date.now();
    const hs = model.full.filter((h) => h.t > now - 36e5 && h.t <= now + 24 * 36e5 && h.cape != null);
    const peak = hs.reduce((a, b) => ((b.cape ?? 0) > (a?.cape ?? -1) ? b : a), null);
    const nova = (model.nova?.hours || []).filter((x) => x.t > now - 36e5 && x.t <= now + 24 * 36e5);
    const risk = nova.length ? nova.reduce((a, b) => (b.p > a.p ? b : a)) : null;
    return { peak, risk };
  }, [model]);
  const shear = storm?.env?.shear0_6kmKmh ?? null;
  const cape = env.peak?.cape ?? storm?.env?.cape ?? null;
  const showsEnv = (env.risk?.p ?? 0) >= 5 || (cape ?? 0) >= 300;
  const type = showsEnv ? stormType(cape, shear) : null;
  const hail = showsEnv ? hailSize(cape, shear, env.peak?.frz) : null;

  const cell = storm?.radar?.cell;
  const coming = cell && cell.etaMin <= 120 && cell.etaMin >= -5 ? cell : null;
  const heavyHere = (storm?.radar?.here ?? 0) >= 4;
  const warn = aiw ? (aiw.over?.[0] ? { w: aiw.over[0], how: 'over' } : aiw.approaching?.[0] ? { w: aiw.approaching[0], how: 'approaching' } : aiw.nearby?.[0] ? { w: aiw.nearby[0], how: 'nearby' } : null) : null;

  if (!L && !coming && !heavyHere && !warn && !type) return null;
  const mph = (kmh) => U.fmtWind(kmh / 1.609344);
  return (
    <div className="lw-glass lw-card lw-sit lw-storm">
      <div className="lw-title"><CloudLightning />Storm watch<span className="lw-title-aside">Updated every minute</span></div>

      {warn && (
        <div className={`lw-aiw is-${warn.w.severity || 'yellow'}`}>
          <ShieldAlert size={18} />
          <div>
            <b>{warn.how === 'over' ? 'AI lightning warning for here' : warn.how === 'approaching' ? 'AI lightning warning heading this way' : 'AI lightning warning nearby'}</b>
            <span>
              {warn.how === 'over' ? `In force${warn.w.expiresAt ? ` until about ${hhmm(warn.w.expiresAt)}` : ''}.` : warn.how === 'approaching' ? `Lightning likely here in about ${warn.w.arrivesInMin} minutes.` : `About ${warn.w.distanceKm} km away.`}
              {' '}MyWeatherUK&rsquo;s AI warnings, from the lightning and the storms&rsquo; own tracks.
            </span>
          </div>
        </div>
      )}

      {L && (
        <div className="lw-sit-row lw-ltg">
          <StrikeMap strikes={ltg.strikes} R={ltg.km} />
          <div>
            <p className="lw-sit-head">
              {L.total} {L.total === 1 ? 'strike' : 'strikes'} within {ltg.km} km in the last hour
              {L.trend === 'closer' ? ', coming closer' : L.trend === 'away' ? ', moving away' : ''}.
            </p>
            <p className="lw-sit-sub">
              The latest {L.last[0] < 1 ? 'just now' : `${Math.round(L.last[0])} min ago`}, {Math.round(L.last[1])} km to the {dir8(L.last[2])}.
              {L.near ? ` Nearest in the last 15 minutes: ${Math.round(L.near[1])} km.` : ''}
            </p>
            {L.danger && <p className="lw-sit-note is-danger"><Zap size={13} />Lightning within 10 km: if you can hear thunder, you are close enough to be struck. Go indoors.</p>}
            <div className="lw-sit-key">
              {AGE_COLOURS.map(([m, col], i) => <React.Fragment key={m}><i style={{ background: col }} />{i === 0 ? 'under 10 min' : i === 3 ? 'up to an hour' : `under ${m} min`}</React.Fragment>)}
            </div>
          </div>
        </div>
      )}

      {(coming || heavyHere) && (
        <div className="lw-sit-row">
          <p className="lw-sit-head"><CloudRain size={15} className="lw-inline-ico" />
            {heavyHere ? 'Heavy rain here now.' : coming.etaMin <= 5
              ? `Heavy rain arriving now (${U.fmtRate(coming.rate)}).`
              : `Heavy rain (${U.fmtRate(coming.rate)}) about ${coming.km} km to the ${dir8(storm.radar.motion.from)}, here in about ${coming.etaMin} minutes.`}
          </p>
          {storm?.radar?.motion && <p className="lw-sit-sub">The rain is moving {dir8(storm.radar.motion.towards)}wards at about {mph(storm.radar.motion.kmh)}. From the Met Office radar scan at {hhmm(Date.parse(storm.radar.scan))}; showers can grow or fade on the way.</p>}
        </div>
      )}

      {type && (
        <div className="lw-sit-row">
          <p className="lw-sit-head">{type.type}{env.risk && env.risk.p >= 5 ? ` · ${thunderRisk(env.risk.p)?.word || 'Low'} thunderstorm risk around ${when(env.risk.t)}` : ''}</p>
          <p className="lw-sit-sub">
            {type.words[0].toUpperCase() + type.words.slice(1)}. Storm energy (CAPE) up to {Math.round(cape)} J/kg{env.peak ? ` around ${when(env.peak.t)}` : ''}; wind shear now {Math.round(shear)} km/h.
            {hail ? ` ${hail}.` : ''}
          </p>
        </div>
      )}
    </div>
  );
}

export function ChangesCard({ model }) {
  const U = useUnits();
  const ch = usePoll((s) => runChanges(model.lat, model.lon, s), [model.lat, model.lon], 10 * 60e3);
  const words = useMemo(() => (ch && !ch.none ? changeWords(ch, U) : null), [ch, U]);
  if (!words?.items.length) return null;
  return (
    <div id="lw-card-changes" className="lw-glass lw-card lw-sit">
      <div className="lw-title"><History />Since the last run<span className="lw-title-aside">UKV {words.cur} against {words.prev}</span></div>
      <ul className="lw-changes">{words.items.map((t) => <li key={t}>{t}.</li>)}</ul>
    </div>
  );
}

export default StormWatch;
