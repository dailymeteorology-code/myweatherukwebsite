/* The two weeks ahead (Location Weather, 16 Nov 2026, Phase G): the days beyond the outlook as the US
   GEFS ensemble average sees them (/api/location/trend, built on the server from each new run), against
   the place's 1991-2020 normal for each date (the Met Office HadUK-Grid district, from the outside feeds).
   An average of 31 runs shows which way the weather leans, milder or colder than normal, not any one
   day's weather, and the card says so. */
import React, { useEffect, useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useUnits } from '@/components/useUnits';
import { dayLabel } from '@/lib/ukvLocation';
import { normalOn } from '@/lib/location/outside';

const SUMMER = new Set([4, 5, 6, 7, 8]);                       // May to September: "warmer", not "milder"
const dateWords = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const partOfMonth = (day) => {
  const d = new Date(`${day}T12:00:00Z`);
  const m = d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  return `${d.getUTCDate() <= 10 ? 'early' : d.getUTCDate() <= 20 ? 'mid-' : 'late'}${d.getUTCDate() <= 10 || d.getUTCDate() > 20 ? ' ' : ''}${m}`;
};

export default function TrendCard({ lat, lon, normal, fromDay }) {
  const U = useUnits();
  const [tr, setTr] = useState(null);
  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
    let alive = true;
    const ac = new AbortController();
    const go = () => fetch(`/api/location/trend?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null)).then((x) => { if (alive) setTr(x && !x.none ? x : null); }).catch(() => {});
    setTr(null);
    go();
    const id = setInterval(go, 30 * 60e3);
    return () => { alive = false; ac.abort(); clearInterval(id); };
  }, [lat, lon]);

  const rows = useMemo(() => {
    if (!tr?.days?.length || !normal) return [];
    return tr.days.filter((d) => !fromDay || d.day > fromDay).map((d) => {
      const n = normalOn(normal, Date.parse(`${d.day}T12:00:00Z`));
      const nm = n ? (n.hi + n.lo) / 2 : null;
      return { ...d, normal: nm, anom: nm == null ? null : d.t - nm };
    }).filter((r) => r.anom != null).slice(0, 9);
  }, [tr, normal, fromDay]);
  if (rows.length < 4) return null;

  const diff = (d) => Math.round(U.isF ? (d * 9) / 5 : d);
  const mean = rows.reduce((s, r) => s + r.anom, 0) / rows.length;
  const warm = SUMMER.has(new Date(`${rows[0].day}T12:00:00Z`).getUTCMonth()) ? 'warmer' : 'milder';
  const lean = mean <= -2.5 ? 'much colder than normal' : mean <= -1 ? 'colder than normal' : mean >= 2.5 ? `much ${warm} than normal` : mean >= 1 ? `${warm} than normal` : 'close to normal';
  const by = Math.abs(diff(mean));
  /* the bars: each day's difference from normal, blue below and orange above, out to 6 C either way */
  const W = 320, H = 92, mid = 44, span = 36, bw = W / rows.length;
  return (
    <div className="lw-glass lw-card lw-trend">
      <div className="lw-title"><TrendingUp />The two weeks ahead<span className="lw-title-aside">GEFS ensemble average</span></div>
      <p className="lw-sit-head">
        From {dateWords(rows[0].day)} the weather leans {lean}{by >= 1 && lean !== 'close to normal' ? `, about ${by}° ${mean < 0 ? 'below' : 'above'} the average for ${partOfMonth(rows[0].day)}` : ''}.
      </p>
      <svg className="lw-trend-bars" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={rows.map((r) => `${dayLabel(r.day)} ${diff(r.anom) > 0 ? '+' : ''}${diff(r.anom)} degrees`).join(', ')}>
        <line x1="0" x2={W} y1={mid} y2={mid} stroke="rgba(255,255,255,0.35)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {rows.map((r, i) => {
          const h = (Math.max(-6, Math.min(6, r.anom)) / 6) * span;
          return <rect key={r.day} x={i * bw + bw * 0.18} width={bw * 0.64} y={h >= 0 ? mid - h : mid} height={Math.max(1.5, Math.abs(h))} rx="3" fill={r.anom < 0 ? '#6ab0ff' : '#ff9a5c'} opacity="0.9" />;
        })}
      </svg>
      <div className="lw-trend-days">{rows.map((r) => <span key={r.day}>{dayLabel(r.day).slice(0, 3)}</span>)}</div>
      <p className="lw-sit-sub">
        Each bar is a day&rsquo;s average temperature against the 1991&ndash;2020 normal{normal?.name ? ` for ${normal.name}` : ''}. It is the average of {tr.members} runs of the US GEFS model, so it shows which way the weather leans, not any one day&rsquo;s weather.
      </p>
    </div>
  );
}
