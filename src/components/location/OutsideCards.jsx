/* What other public bodies say about the place (Location Weather, 16 Nov 2026, Phase E), from
   src/lib/location/outside.js:
     AlertsCard   flood warnings and alerts nearby (the Environment Agency; SEPA in Scotland) and UKHSA's
                  heat- and cold-health alerts for the region, only while one is in force
     CoastCard    the sea level at the nearest tide gauge over the last day, on the coast only
     AirTile      DEFRA's air quality forecast for the next days, one of the detail tiles
   and useOutside, which reads them for a place and again every ten minutes. */
import React, { useEffect, useMemo, useState } from 'react';
import { Waves, HeartPulse, ExternalLink, Leaf, Droplets } from 'lucide-react';
import { hhmm, dayLabel, ukDay } from '@/lib/ukvLocation';
import { fetchOutside, FLOOD_LEVELS, HEALTH_COLOURS, tideNow, DAQI_COLOURS, daqiWord, DAQI_ADVICE } from '@/lib/location/outside';

/** The outside feeds for a place: null until they arrive (or when they cannot be read). */
export function useOutside(lat, lon) {
  const [v, setV] = useState(null);
  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
    let alive = true, ac = null;
    setV(null);
    const go = () => {
      if (document.hidden) return;
      ac?.abort(); ac = new AbortController();
      fetchOutside(lat, lon, ac.signal).then((x) => { if (alive) setV(x); }).catch(() => {});
    };
    go();
    const id = setInterval(go, 10 * 60e3);
    return () => { alive = false; ac?.abort(); clearInterval(id); };
  }, [lat, lon]);
  return v;
}

/* "14:20", or "Tue 14:20" on another day */
const when = (iso) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = ukDay(t);
  return `${d === ukDay(Date.now()) ? '' : `${dayLabel(d)} `}${hhmm(t)}`;
};
const Link = ({ href, children }) => (
  <a className="lw-out-link" href={href} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={12} aria-hidden="true" /></a>
);
/* an alert's paragraphs and its list's points, as UKHSA writes them */
function Lines({ lines }) {
  const out = [];
  let list = null;
  lines.forEach((l, i) => {
    if (l.li) { if (!list) { list = []; out.push(<ul key={`u${i}`} className="lw-out-list">{list}</ul>); } list.push(<li key={i}>{l.text}</li>); }
    else { list = null; out.push(<p key={i} className="lw-sit-sub">{l.text}</p>); }
  });
  return out;
}

/* ── flood warnings and health alerts ── */
export function AlertsCard({ outside }) {
  const ea = outside?.floods?.england || [], sepa = outside?.floods?.scotland || [], health = outside?.health || [];
  if (!ea.length && !sepa.length && !health.length) return null;
  const floods = ea.length + sepa.length;
  /* the title says what kind; each row's badge says which and how serious */
  const title = floods && health.length ? 'Flood and health alerts' : floods ? (ea.some((x) => x.level <= 2) || sepa.length ? 'Flood warnings' : 'Flood alerts') : 'Weather-health alert';
  return (
    <div id="lw-card-alerts" className="lw-glass lw-card lw-sit lw-alerts">
      <div className="lw-title">{floods ? <Waves /> : <HeartPulse />}{title}<span className="lw-title-aside">{floods ? 'Within 15 km' : 'UK Health Security Agency'}</span></div>
      {ea.map((x) => {
        const L = FLOOD_LEVELS[x.level];
        return (
          <div key={`${x.link}|${x.area}`} className="lw-sit-row">
            <span className="lw-out-badge" style={{ background: L.colour, color: L.ink }}>{L.name}</span>
            <p className="lw-sit-head">{x.area}</p>
            <p className="lw-sit-sub">{L.words}.{x.water ? ` ${x.water}.` : ''} Updated {when(x.changed || x.raised)}.</p>
            {x.message && (
              <details className="lw-out-more"><summary>What the Environment Agency says</summary><p className="lw-sit-sub">{x.message}</p></details>
            )}
            <Link href={x.link}>Check for flooding</Link>
          </div>
        );
      })}
      {sepa.length > 0 && (
        <div className="lw-sit-row">
          <p className="lw-sit-head">{sepa.length === 1 ? 'A flood warning' : `${sepa.length} flood warnings`} in force in Scotland</p>
          <ul className="lw-out-list">{sepa.slice(0, 6).map((x) => <li key={x.link || x.title}>{x.link ? <Link href={x.link}>{x.title}</Link> : x.title}</li>)}</ul>
        </div>
      )}
      {health.map((a) => {
        const [bg, ink] = HEALTH_COLOURS[a.status] || HEALTH_COLOURS.Yellow;
        return (
          <div key={a.kind} className="lw-sit-row">
            <span className="lw-out-badge" style={{ background: bg, color: ink }}>{a.status} {a.kind}-health alert</span>
            <p className="lw-sit-head">{a.region}{a.from ? `, from ${when(a.from)}` : ''}{a.to ? ` until ${when(a.to)}` : ''}</p>
            <Lines lines={a.lines || []} />
            <Link href={a.link}>UKHSA weather-health alerts</Link>
          </div>
        );
      })}
      <p className="lw-out-src">
        {[floods && (ea.length ? 'Environment Agency' : 'SEPA'), health.length && 'UK Health Security Agency (for health and care services; England only)'].filter(Boolean).join(' · ')}.
      </p>
    </div>
  );
}

/* ── the tide ── */
function TideLine({ tide, now }) {
  const W = 320, H = 86, pad = 6;
  const p = tide.points;
  const t0 = p[0][0], t1 = p[p.length - 1][0];
  const vs = p.map((x) => x[1]);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const sx = (t) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad * 2);
  const sy = (v) => H - pad - ((v - lo) / Math.max(0.1, hi - lo)) * (H - pad * 2 - 10);
  const line = p.map(([t, v], i) => `${i ? 'L' : 'M'}${sx(t).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ');
  return (
    <svg className="lw-tide" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="The sea level over the last day">
      <defs>
        <linearGradient id="lw-tide-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5fb4ff" stopOpacity="0.55" /><stop offset="1" stopColor="#5fb4ff" stopOpacity="0.04" /></linearGradient>
      </defs>
      <path d={`${line} L${sx(t1).toFixed(1)} ${H} L${sx(t0).toFixed(1)} ${H} Z`} fill="url(#lw-tide-fill)" />
      <path d={line} fill="none" stroke="#9fd2ff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={sx(now.t)} cy={sy(now.v)} r="4" fill="#fff" />
    </svg>
  );
}
export function CoastCard({ outside }) {
  const tide = outside?.tide;
  const now = useMemo(() => tideNow(tide), [tide]);
  if (!tide || !now) return null;
  const m = (v) => `${v.toFixed(1)} m`;
  const way = now.rising ? 'Rising' : now.falling ? 'Falling' : 'About at the turn';
  return (
    <div id="lw-card-coast" className="lw-glass lw-card lw-sit">
      <div className="lw-title"><Droplets />The tide<span className="lw-title-aside">{tide.station} gauge · {tide.km} km</span></div>
      <p className="lw-sit-head">{way}: the sea is at {m(now.v)}, measured at {hhmm(now.t)}.</p>
      <TideLine tide={tide} now={now} />
      <div className="lw-tide-axis"><span>A day ago</span><span>Now</span></div>
      <p className="lw-sit-sub">
        {[now.high && `Last high water ${when(new Date(now.high.t).toISOString())} (${m(now.high.v)})`, now.low && `last low water ${when(new Date(now.low.t).toISOString())} (${m(now.low.v)})`].filter(Boolean).join(', ')}.
        {' '}Heights are above Ordnance Datum, which is about mean sea level. From the Environment Agency&rsquo;s tide gauge; tide times need the Admiralty&rsquo;s tables.
      </p>
    </div>
  );
}

/* ── air quality, as one of the detail tiles ── */
export function AirTile({ outside }) {
  const air = outside?.air;
  if (!air?.days?.length) return null;
  const today = ukDay(Date.now());
  const days = air.days.filter((d) => d.day >= today).slice(0, 5);
  if (!days.length) return null;
  const v = days[0].v, word = daqiWord(v);
  const worst = days.reduce((a, b) => (b.v > a.v ? b : a));
  return (
    <div className="lw-glass lw-tile">
      <div className="lw-title"><Leaf />Air quality</div>
      <div className="lw-big">{word}<small>{v} of 10</small></div>
      <div className="lw-aq" role="img" aria-label={`Air quality index for the next days: ${days.map((d) => `${dayLabel(d.day)} ${d.v}`).join(', ')}`}>
        {days.map((d) => (
          <span key={d.day}>
            <i style={{ background: DAQI_COLOURS[d.v] || 'rgba(255,255,255,0.2)' }} />
            {d.day === today ? 'Today' : dayLabel(d.day).slice(0, 3)}
          </span>
        ))}
      </div>
      <div className="lw-foot">
        {worst.v >= 4 && worst.day !== days[0].day ? `${daqiWord(worst.v)} on ${dayLabel(worst.day)}. ` : ''}
        {DAQI_ADVICE[daqiWord(Math.max(v, worst.v))].split(';')[0].replace(/\.$/, '')}.
      </div>
      <div className="lw-mini" style={{ marginTop: 4 }}>DEFRA forecast for {air.site.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}{air.km >= 2 ? `, ${air.km} km away` : ''}</div>
    </div>
  );
}
