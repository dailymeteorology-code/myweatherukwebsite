/* Your places (Location Weather, 15 Nov 2026, Phase D):
     • SaveStar: keep this place (the star by its name)
     • PlacesStrip: your places, each with the temperature and sky now, one tap away; mark one Home and
       one Work; compare them
     • CompareSheet: two to four places side by side, the days and the next two days' temperature
     • CommuteCard: Home to Work and back at your times, the weather at both ends and half way
   Kept by src/lib/location/places.js (this browser, and the account when signed in). */
import React, { useEffect, useMemo, useState } from 'react';
import { Star, Home, Briefcase, X, GitCompareArrows, Pencil, Check, Route } from 'lucide-react';
import WxIcon from '@/components/location/WxIcon';
import { useUnits } from '@/components/useUnits';
import { fetchLocation, cachedLocation, shape, sunElevation, hhmm, ukDay, dayLabel, condLabel, rateOf, PRECIP_KINDS } from '@/lib/ukvLocation';
import { isSaved, toggleSaved, setLabel, placeWith, samePlace } from '@/lib/location/places';
import { parseMoment } from '@/components/location/HourSheet';

/* the sky now from /api/location/now (cloud and the radar's rain) as a symbol */
function nowCond(n, lat, lon) {
  const day = sunElevation(Date.now(), lat, lon) > -0.833;
  const r = n?.radar ?? 0, c = n?.tcc ?? 50;   // nothing yet: a middling sky until it comes
  const cond = r >= 4 ? 'heavyRain' : r >= 1 ? 'rain' : r >= 0.1 ? 'lightRain' : c < 15 ? 'clear' : c < 38 ? 'mostlyClear' : c < 62 ? 'partly' : c < 82 ? 'mostlyCloudy' : 'cloudy';
  return { cond, day };
}

export function SaveStar({ place, data, onChange }) {
  if (!place) return null;
  const saved = isSaved(data, place);
  return (
    <button type="button" className={`lw-star${saved ? ' is-on' : ''}`} onClick={() => onChange(toggleSaved(data, place))}
      aria-pressed={saved} aria-label={saved ? `Remove ${place.name} from your places` : `Keep ${place.name} in your places`} title={saved ? 'In your places' : 'Keep in your places'}>
      <Star size={16} fill={saved ? 'currentColor' : 'none'} />{saved ? 'Saved' : 'Save'}
    </button>
  );
}

export function PlacesStrip({ data, current, onOpen, onChange, onCompare }) {
  const U = useUnits();
  const [now, setNow] = useState([]);
  const [edit, setEdit] = useState(false);
  const key = data.places.map((p) => `${p.lat},${p.lon}`).join('|');
  useEffect(() => {
    if (!data.places.length) return undefined;
    const ac = new AbortController();
    fetch(`/api/location/now?p=${key}`, { signal: ac.signal }).then((r) => (r.ok ? r.json() : null)).then((j) => j && setNow(j.places || [])).catch(() => {});
    return () => ac.abort();
  }, [key, data.places.length]);
  if (!data.places.length) return null;
  return (
    <section className="lw-places" aria-label="Your places">
      <div className="lw-places-head">
        <b>Your places</b>
        {data.places.length >= 2 && <button type="button" className="lw-chip" onClick={onCompare}><GitCompareArrows size={14} />Compare</button>}
        <button type="button" className="lw-chip" aria-pressed={edit} onClick={() => setEdit((e) => !e)}>{edit ? <Check size={14} /> : <Pencil size={13} />}{edit ? 'Done' : 'Edit'}</button>
      </div>
      <div className="lw-places-row">
        {data.places.map((p, i) => {
          const n = now[i];
          const { cond, day } = nowCond(n, p.lat, p.lon);
          const here = current && samePlace(current, p);
          return (
            <div key={`${p.lat},${p.lon}`} className={`lw-place lw-glass${here ? ' is-here' : ''}`}>
              <button type="button" className="lw-place-open" onClick={() => onOpen(p)} aria-label={`${p.name}${n ? `, ${Math.round(U.temp(n.t2))} degrees` : ''}`}>
                <span className="lw-place-name">{p.label === 'home' && <Home size={12} />}{p.label === 'work' && <Briefcase size={12} />}{p.name}</span>
                <span className="lw-place-now">
                  {n ? <><WxIcon cond={cond} day={day} size={26} title={condLabel(cond, day)} /><b>{Math.round(U.temp(n.t2))}°</b></> : <i className="lw-place-wait" />}
                </span>
              </button>
              {edit && (
                <div className="lw-place-edit">
                  <button type="button" aria-pressed={p.label === 'home'} onClick={() => onChange(setLabel(data, p, 'home'))} title="This is Home"><Home size={13} />Home</button>
                  <button type="button" aria-pressed={p.label === 'work'} onClick={() => onChange(setLabel(data, p, 'work'))} title="This is Work"><Briefcase size={13} />Work</button>
                  <button type="button" onClick={() => onChange(toggleSaved(data, p))} aria-label={`Remove ${p.name}`} title="Remove"><X size={13} /></button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {edit && <p className="lw-places-hint">Mark one place Home and one Work to see your commute.</p>}
    </section>
  );
}

/* a place's shaped forecast: what was fetched in the last 20 minutes at once, then fresh */
function useForecasts(places) {
  const [models, setModels] = useState({});
  const key = places.map((p) => `${p.lat},${p.lon}`).join('|');
  useEffect(() => {
    const ac = new AbortController();
    for (const p of places) {
      const k = `${p.lat},${p.lon}`;
      const c = cachedLocation({ lat: p.lat, lon: p.lon, name: p.name });
      if (c?.location) { try { const m = shape(c); setModels((s) => ({ ...s, [k]: m })); } catch { /* fetch below */ } }
      fetchLocation({ lat: p.lat, lon: p.lon, name: p.name }, ac.signal)
        .then((r) => { if (r?.location) { const m = shape(r); setModels((s) => ({ ...s, [k]: m })); } })
        .catch(() => {});
    }
    return () => ac.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return models;
}

const LINE = ['#7cc9ff', '#ffb347', '#7cf2b3', '#f78fb3'];
export function CompareSheet({ data, current, onClose }) {
  const U = useUnits();
  const pool = useMemo(() => {
    const list = [...data.places];
    if (current && !list.some((p) => samePlace(p, current))) list.unshift(current);
    return list;
  }, [data.places, current]);
  const [picked, setPicked] = useState(() => pool.slice(0, Math.min(3, pool.length)).map((p) => `${p.lat},${p.lon}`));
  const chosen = pool.filter((p) => picked.includes(`${p.lat},${p.lon}`));
  const models = useForecasts(chosen);
  const ms = chosen.map((p) => models[`${p.lat},${p.lon}`] || null);
  const days = (ms.find(Boolean)?.outlook?.days || []).slice(0, 7);
  const deg = (c) => (c == null ? '—' : `${Math.round(U.temp(c))}°`);
  /* the next 48 hours' temperatures, one line a place */
  const t0 = Date.now(), t1 = t0 + 48 * 36e5;
  const lines = ms.map((m) => (m ? m.full.filter((h) => h.t >= t0 - 36e5 && h.t <= t1 && h.t2 != null) : []));
  const all = lines.flat().map((h) => h.t2);
  const lo = all.length ? Math.floor(Math.min(...all)) - 1 : 0, hi = all.length ? Math.ceil(Math.max(...all)) + 1 : 10;
  const W = 640, H = 170, P = 26;
  const sx = (t) => P + ((t - t0) / (t1 - t0)) * (W - P - 8), sy = (v) => 8 + (1 - (v - lo) / (hi - lo)) * (H - 30);
  /* ticks on whole hours every 12 hours, named by the day */
  const first = Math.ceil(t0 / 36e5) * 36e5;
  const ticks = [];
  for (let t = first; t <= t1; t += 36e5) if (Number(hhmm(t).slice(0, 2)) % 12 === 0) ticks.push(t);
  const tickLabel = (t) => `${new Date(t).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Europe/London' })} ${hhmm(t)}`;
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="lw-sh-wrap" onClick={onClose} onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
      <div className="lw-sh lw-glass lw-compare" role="dialog" aria-modal="true" aria-label="Compare places" onClick={(e) => e.stopPropagation()}>
        <div className="lw-sh-head">
          <div className="lw-sh-when"><b>Compare places</b><span>Up to four at once</span></div>
          <button type="button" className="lw-icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="lw-compare-pick">
          {pool.map((p) => {
            const k = `${p.lat},${p.lon}`, on = picked.includes(k), i = chosen.findIndex((c) => `${c.lat},${c.lon}` === k);
            return (
              <button key={k} type="button" className="lw-chip" aria-pressed={on} disabled={!on && picked.length >= 4}
                onClick={() => setPicked((s) => (on ? s.filter((x) => x !== k) : [...s, k]))}>
                {on && <i className="lw-dot" style={{ background: LINE[i] }} />}{p.name}
              </button>
            );
          })}
        </div>
        <div className="lw-sh-body">
          {chosen.length > 0 && (
            <>
              <svg className="lw-compare-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Temperature over the next 48 hours at each place">
                {[lo, Math.round((lo + hi) / 2), hi].map((v) => <g key={v}><line x1={P} x2={W - 8} y1={sy(v)} y2={sy(v)} stroke="rgba(255,255,255,0.1)" /><text x={P - 4} y={sy(v) + 4} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.55)">{deg(v)}</text></g>)}
                {ticks.map((t) => <g key={t}><line x1={sx(t)} x2={sx(t)} y1={8} y2={H - 22} stroke="rgba(255,255,255,0.07)" /><text x={sx(t)} y={H - 6} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.55)">{tickLabel(t)}</text></g>)}
                {lines.map((hs, i) => (hs.length > 1 ? <polyline key={i} fill="none" stroke={LINE[i]} strokeWidth="2.2" strokeLinejoin="round" points={hs.map((h) => `${sx(h.t).toFixed(1)},${sy(h.t2).toFixed(1)}`).join(' ')} /> : null))}
              </svg>
              <div className="lw-compare-table" style={{ gridTemplateColumns: `64px repeat(${chosen.length}, minmax(0, 1fr))` }}>
                <span />
                {chosen.map((p, i) => <b key={`${p.lat},${p.lon}`}><i className="lw-dot" style={{ background: LINE[i] }} />{p.name}</b>)}
                {days.map((d) => (
                  <React.Fragment key={d.day}>
                    <span className="lw-compare-day">{d.label}</span>
                    {ms.map((m, i) => {
                      const x = m?.outlook?.days?.find((y) => y.day === d.day);
                      return (
                        <span key={i} className="lw-compare-cell">
                          {x ? <><WxIcon cond={x.cond} day size={24} title={condLabel(x.cond, true)} /><b>{deg(x.hi)}</b><small>{deg(x.lo)}</small>{x.pRain >= 20 ? <em>{x.pRain}%</em> : null}</> : '…'}
                        </span>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── the commute: the next out and back legs on your commute days ── */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function nextLegs(commute, nowMs = Date.now()) {
  const out = [];
  for (let k = 0; k < 8 && out.length < 2; k++) {
    const day = ukDay(nowMs + k * 864e5);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (!commute.days.includes(dow)) continue;
    for (const [leg, time] of [['Out', commute.out], ['Back', commute.back]]) {
      const t = parseMoment(`${day}T${time}`);
      if (t != null && t > nowMs - 30 * 60e3 && out.length < 2) out.push({ leg, t, day });
    }
  }
  return out;
}
function atTime(m, t) {
  if (!m) return null;
  let best = null;
  for (const h of m.full) if (!best || Math.abs(h.t - t) < Math.abs(best.t - t)) best = h;
  return best && Math.abs(best.t - t) <= 3 * 36e5 ? best : null;
}
function legWords(h, U) {
  if (!h) return '…';
  const r = rateOf(h);
  const bits = [condLabel(h.cond, h.isDay, h.windy), `${Math.round(U.temp(h.t2))}${U.tempUnit}`];
  if (r >= 0.1) bits.push(`${PRECIP_KINDS[h.kind]?.name.toLowerCase() || 'rain'} ${U.fmtRate(r)}`);
  else if ((h.pRain ?? 0) >= 40) bits.push(`${h.pRain}% chance of rain`);
  if ((h.gust ?? 0) >= 35) bits.push(`gusts ${U.fmtWind(h.gust)}`);
  if ((h.ground ?? 9) <= 0) bits.push('icy surfaces');
  return bits.join(', ');
}
export function CommuteCard({ data, onChange }) {
  const U = useUnits();
  const home = placeWith(data, 'home'), work = placeWith(data, 'work');
  const mid = home && work ? { name: 'Half way', lat: (home.lat + work.lat) / 2, lon: (home.lon + work.lon) / 2 } : null;
  const far = home && work && Math.hypot(home.lat - work.lat, (home.lon - work.lon) * 0.62) > 0.15;   // ~15 km and more: half way is worth a look
  const pts = [home, ...(far ? [mid] : []), work].filter(Boolean);
  const models = useForecasts(home && work ? pts : []);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(data.commute);
  useEffect(() => setDraft(data.commute), [data.commute]);
  if (!home || !work) return null;
  const legs = nextLegs(data.commute);
  return (
    <div id="lw-card-commute" className="lw-glass lw-card lw-sit">
      <div className="lw-title"><Route />Your commute<span className="lw-title-aside">{home.name} – {work.name}</span></div>
      {legs.map((l) => {
        const [a, b] = l.leg === 'Out' ? [pts[0], pts[pts.length - 1]] : [pts[pts.length - 1], pts[0]];
        const order = l.leg === 'Out' ? pts : [...pts].reverse();
        return (
          <div key={`${l.leg}${l.t}`} className="lw-sit-row">
            <p className="lw-sit-head">{l.leg} {dayLabel(l.day)} {hhmm(l.t)}: {a.name} to {b.name}</p>
            <ul className="lw-commute">
              {order.map((p) => <li key={p.name}><b>{p.name}</b>{legWords(atTime(models[`${p.lat},${p.lon}`], l.t), U)}</li>)}
            </ul>
          </div>
        );
      })}
      {!legs.length && <p className="lw-sit-sub">No commute in the next week on your days.</p>}
      {edit ? (
        <div className="lw-commute-edit">
          <label>Out <input type="time" value={draft.out} onChange={(e) => setDraft({ ...draft, out: e.target.value })} /></label>
          <label>Back <input type="time" value={draft.back} onChange={(e) => setDraft({ ...draft, back: e.target.value })} /></label>
          <div className="lw-seg" role="group" aria-label="Commute days">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <button key={d} type="button" aria-pressed={draft.days.includes(d)} onClick={() => setDraft({ ...draft, days: draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d] })}>{DAYS[d][0]}</button>
            ))}
          </div>
          <button type="button" className="lw-chip" aria-pressed="true" onClick={() => { onChange({ ...data, commute: draft }); setEdit(false); }}>Save</button>
        </div>
      ) : (
        <button type="button" className="lw-chip lw-commute-change" onClick={() => setEdit(true)}><Pencil size={13} />Change times and days</button>
      )}
    </div>
  );
}
