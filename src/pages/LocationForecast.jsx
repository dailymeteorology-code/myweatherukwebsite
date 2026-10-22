/* Location Weather.

   One place's weather from the Met Office UKV 2 km model on AWS (server/locationWeather.js),
   in liquid glass over a live animated sky:
     • the hero: the temperature now, from the 15-minute UKV + station analysis
     • weather warnings whose area covers the place
     • the hourly strip to T+120 (hourly to T+54, then three-hourly, as UKV publishes)
     • precipitation, when there is any: the next hour minute by minute (the Met Office radar
       carried forward by the rain's own motion), or the next 12 hours from UKV
     • rain splashing on the top row of cards while it rains (CardRain in SkyBackdrop.jsx), and
       drops on every card's glass, as on a window (WindowRain)
     • the days, with their ranges on one shared scale
     • the Met Office radar for the past three hours and UKV rain for the next hours
     • fourteen detail tiles and ten interactive charts
   The route key stays "LocationWeather" (pages.config.js), so every old link still works;
   ?location=Name opens a place directly. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Clock3, CalendarDays, Radar, AlertTriangle, CloudRain, ChevronLeft, ChevronRight, Loader2, Palette, LocateFixed, MoreHorizontal, Link2, Thermometer, Check,
  Umbrella, Sunrise, Sunset,
} from 'lucide-react';
import LocationSearchBox from '@/components/location/LocationSearchBox';
import LocationLanding from '@/components/location/LocationLanding';
import LocationWarnings, { warningIcon, warningName, warningSpan, severityFill, severityInk } from '@/components/location/LocationWarnings';
import LocationRadar from '@/components/location/LocationRadar';
import LocationTiles from '@/components/location/LocationTiles';
import LocationCharts, { tempColour } from '@/components/location/LocationCharts';
import SkyBackdrop, { CardRain, WindowRain, skyDarkness } from '@/components/location/SkyBackdrop';
import SkyPreview, { PREVIEW_START, previewSky } from '@/components/location/SkyPreview';
import { isCurrentUserAdmin } from '@/lib/tcmFetchPolicy';
import WxIcon from '@/components/location/WxIcon';
import '@/components/location/location.css';
import { currentUser, loadRecent, rememberSearch, forgetSearch, clearRecent } from '@/lib/locationHistory';
import { fetchAllWarningsForPoint } from '@/lib/locationWarnings';
import {
  fetchLocation, shape, condLabel, isWet, nextHoursText, dayText, hhmm, hourOf, sunElevation, compass,
  minutelyText, wetMinute, bandOf, ukDay,
} from '@/lib/ukvLocation';

const REFRESH_MS = 5 * 60e3;                       // a new radar scan every 15 minutes: the next hour follows each one
const runName = (iso) => {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}Z ${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}`;
};

/* ── the hourly strip ────────────────────────────────────────────────────── */
const COL_W = 58;                                  // every column of the strip (.lw-hour, border-box)
const LANE_H = 24;                                 // one warning bar, with its gap
function HourlyCard({ model, T, stripRef, warnings, onWarning }) {
  const items = useMemo(() => {
    const start = model.full.findIndex((h) => h.t >= Date.now() - 30 * 60e3);
    const hs = model.full.slice(Math.max(0, start));
    if (!hs.length) return [];
    const from = hs[0].t, to = hs[hs.length - 1].t;
    const suns = [];
    for (const d of model.days) {
      if (d.sun.rise && d.sun.rise > from && d.sun.rise < to) suns.push({ sun: 'Sunrise', t: d.sun.rise });
      if (d.sun.set && d.sun.set > from && d.sun.set < to) suns.push({ sun: 'Sunset', t: d.sun.set });
    }
    return [...hs.map((h) => ({ h, t: h.t })), ...suns].sort((a, b) => a.t - b.t);
  }, [model]);
  /* Each warning as a bar in its colour under exactly the columns it covers: an hour column covers
     its hour (three hours beyond T+54), a sunrise or sunset column its moment. One lane per
     warning, the most severe on top; the label stays in view while the bar is scrolled through. */
  const lanes = useMemo(() => {
    if (!items.length) return [];
    const out = [];
    for (const w of warnings) {
      if (!w.startMs || !w.endMs) continue;
      let a = -1, b = -1;
      items.forEach((it, k) => {
        const t0 = it.t, t1 = it.h ? it.t + Math.max(1, it.h.span || 1) * 3600e3 : it.t + 1;
        if (t0 < w.endMs && t1 > w.startMs) { if (a < 0) a = k; b = k; }
      });
      if (a < 0) continue;
      out.push({ w, a, b, openStart: w.startMs < items[0].t, openEnd: w.endMs > items[items.length - 1].t + 3600e3 });
    }
    return out;
  }, [items, warnings]);
  const scroll = (dir) => stripRef.current?.scrollBy({ left: dir * stripRef.current.clientWidth * 0.8, behavior: 'smooth' });
  let lastDay = null;
  return (
    <div className="lw-glass lw-card">
      <div className="lw-title">
        <Clock3 />Hourly forecast
        <span className="lw-hours-nav">
          <button type="button" className="lw-icon-btn" onClick={() => scroll(-1)} aria-label="Earlier hours"><ChevronLeft size={15} /></button>
          <button type="button" className="lw-icon-btn" onClick={() => scroll(1)} aria-label="Later hours"><ChevronRight size={15} /></button>
        </span>
      </div>
      <p className="lw-summary">{nextHoursText(model)}</p>
      <div className="lw-hours" ref={stripRef}
        onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && e.currentTarget.scrollWidth > e.currentTarget.clientWidth) { e.currentTarget.scrollLeft += e.deltaY; } }}>
        <div className="lw-hours-track" style={lanes.length ? { paddingBottom: lanes.length * LANE_H + 6 } : undefined}>
        {lanes.map(({ w, a, b, openStart, openEnd }, j) => {
          const Icon = warningIcon(w.type);
          const fill = severityFill(w.severity);
          const bottom = 4 + (lanes.length - 1 - j) * LANE_H;
          const toBar = () => stripRef.current?.scrollTo({ left: Math.max(0, a * COL_W - 24), behavior: 'smooth' });
          return (
            <React.Fragment key={w.id}>
            {/* the hours it covers, washed faintly in its colour */}
            <i className="lw-wwash" aria-hidden="true" style={{ left: a * COL_W, width: (b - a + 1) * COL_W, background: `linear-gradient(180deg, ${fill}00, ${fill}24)` }} />
            {/* until the bar is in view, its lane says what is coming and takes you there */}
            {a >= 5 && (
              <div className="lw-wahead" style={{ width: a * COL_W, bottom }}>
                <button type="button" onClick={toBar}>
                  <Icon size={12} strokeWidth={2.4} style={{ color: fill }} />
                  {w.severity} {String(w.type).toLowerCase()} warning from {new Date(w.startMs).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Europe/London' })} {hhmm(w.startMs)}
                  <ChevronRight size={13} />
                </button>
              </div>
            )}
            <div role="button" tabIndex={0} className="lw-wbar"
              onClick={() => onWarning(w.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onWarning(w.id); } }}
              title={`${warningName(w)}, ${warningSpan(w)}`} aria-label={`${warningName(w)}, ${warningSpan(w)}. Show the warning.`}
              style={{
                left: a * COL_W + (openStart ? 0 : 3), width: (b - a + 1) * COL_W - (openStart ? 0 : 3) - (openEnd ? 0 : 3),
                bottom, background: fill, color: severityInk(w.severity),
                borderRadius: `${openStart ? 0 : 8}px ${openEnd ? 0 : 8}px ${openEnd ? 0 : 8}px ${openStart ? 0 : 8}px`,
              }}>
              <span className="lw-wbar-label"><Icon size={13} strokeWidth={2.4} />{w.severity} warning · {w.type}</span>
            </div>
            </React.Fragment>
          );
        })}
        {items.map((it, k) => {
          const day = new Date(it.t).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Europe/London' });
          const dayStart = it.h && lastDay !== null && it.h.day !== lastDay;
          if (it.h) lastDay = it.h.day;
          if (it.sun) {
            return (
              <div key={`s${it.t}`} className="lw-hour">
                <span className="lw-h-day" />
                <span className="lw-h-time">{hhmm(it.t)}</span>
                <WxIcon cond={it.sun === 'Sunrise' ? 'sunrise' : 'sunset'} day size={30} title={it.sun} />
                <span className="lw-h-pop" />
                <span className="lw-h-temp" style={{ fontSize: 13, fontWeight: 600 }}>{it.sun}</span>
              </div>
            );
          }
          const h = it.h;
          const pop = h.pRain != null && h.pRain >= 20 && isWet(h.cond) ? `${h.pRain}%` : h.pRain >= 40 ? `${h.pRain}%` : '';
          return (
            <div key={h.t} className={`lw-hour${k === 0 ? ' is-now' : ''}${dayStart ? ' is-day-start' : ''}`} data-day={h.day}>
              <span className="lw-h-day">{dayStart ? day : ''}</span>
              <span className="lw-h-time">{k === 0 ? 'Now' : h.span > 1 ? hhmm(h.t) : String(hourOf(h.t)).padStart(2, '0')}</span>
              <WxIcon cond={k === 0 ? model.now.cond : h.cond} day={k === 0 ? model.now.isDay : h.isDay} windy={k === 0 ? model.now.windy : h.windy} size={30}
                title={k === 0 ? condLabel(model.now.cond, model.now.isDay, model.now.windy) : condLabel(h.cond, h.isDay, h.windy)} />
              <span className="lw-h-pop">{pop}</span>
              <span className="lw-h-temp">{Math.round(T(k === 0 ? model.now.t2 : h.t2))}°</span>
              <span className="lw-h-wind" title={`Wind ${Math.round(h.wind)} mph from the ${compass(h.wdir)}`}>
                <svg width="9" height="9" viewBox="-5 -5 10 10" style={{ transform: `rotate(${(h.wdir ?? 0) + 180}deg)` }}><path d="M0 -5 L3.5 3 L0 1.4 L-3.5 3Z" fill="currentColor" /></svg>
                {Math.round(h.wind)}
              </span>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}

/* ── precipitation: the next hour minute by minute, or the next 12 hours (only when there is some) ──
   The next hour is the Met Office radar carried forward by the rain's own motion (the server's
   nowcast); the 12 hours are UKV. Both use one scale with equal room for light, moderate and
   heavy (square root up to heavy at 4 mm/h, compressed above), so a downpour reads as one. */
const barHeight = (r) => { if (!(r > 0)) return 0; const s = Math.sqrt(r); return s < 2 ? s / 3 : Math.min(1, (s + 2) / 6); };
const BAND_WORDS = ['Dry', 'Light', 'Moderate', 'Heavy'];
const HEADING = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
function PrecipGuides() {
  return (
    <>
      {[1, 4].map((r) => <i key={r} className="lw-pguide" style={{ bottom: `${barHeight(r) * 100}%` }} />)}
      {BAND_WORDS.slice(1).map((w, k) => <span key={w} className="lw-pband" style={{ bottom: `${(k + 0.5) * (100 / 3)}%` }}>{w}</span>)}
    </>
  );
}
function PrecipCard({ model }) {
  const [view, setView] = useState(null);                         // null: the hour when rain is near, else the 12 hours
  const [hover, setHover] = useState(null);
  const barsRef = useRef(null);
  const mm = model.minutely;
  const hs = model.full.filter((h) => h.t > Date.now() - 30 * 60e3).slice(0, 12);
  const wetHours = hs.filter((h) => isWet(h.cond));
  const wetSoon = !!mm?.mins.some(wetMinute);
  if (!wetSoon && !(wetHours.length && hs.length >= 4)) return null;
  const v = mm ? view || (wetSoon || !wetHours.length ? 'hour' : 'day') : 'day';
  const nowWet = isWet(model.now.cond);
  const nowLabel = nowWet ? condLabel(model.now.cond, true) : null;
  const pick = (list) => (e) => {
    const r = barsRef.current?.getBoundingClientRect();
    if (!r) return;
    setHover(Math.max(0, Math.min(list.length - 1, Math.floor(((e.clientX - r.left) / r.width) * list.length))));
  };

  let body;
  if (v === 'hour') {
    const { mins } = mm;
    const word = (b) => (b ? `${BAND_WORDS[b]} ${mm.snow ? 'snow' : 'rain'}` : 'Dry');
    const hm = hover != null ? mins[hover] : null;
    const motion = mm.motion && mm.motion.kmh >= 3 ? `, the rain moving ${HEADING[Math.round(mm.motion.towards / 45) % 8]} at ${Math.round(mm.motion.kmh / 1.609)} mph` : '';
    body = (
      <>
        <p className="lw-summary lw-psum">{minutelyText(mm, nowLabel)}</p>
        <div className="lw-pchart" onPointerMove={pick(mins)} onPointerDown={pick(mins)} onPointerLeave={() => setHover(null)}
          role="img" aria-label={`Rain each minute for the next hour. ${minutelyText(mm, nowLabel)}`}>
          <PrecipGuides />
          <div className="lw-pbars" ref={barsRef}>
            {mins.map((m) => (
              <i key={m.t} className={m.rate < 0.1 ? 'is-dry' : mm.snow ? 'is-snow' : ''}
                style={{ height: `${Math.max(m.rate < 0.1 ? 1.5 : 4, barHeight(m.rate) * 100)}%`, opacity: m.rate < 0.1 ? 1 : 0.4 + 0.6 * (m.chance / 100) }} />
            ))}
            {hover != null && <b className="lw-pcursor" style={{ left: `${((hover + 0.5) / mins.length) * 100}%` }} />}
          </div>
        </div>
        <div className="lw-paxis"><span>Now</span><span>15 min</span><span>30 min</span><span>45 min</span><span>{mins.length > 55 ? '60 min' : `${mins.length - 1} min`}</span></div>
        <p className="lw-pnote">
          {hm ? <><b>{hhmm(hm.t)}</b> · {word(bandOf(hm.rate))}{hm.rate >= 0.1 ? ` · ${hm.rate.toFixed(1)} mm/h · ${hm.chance}% chance` : ''}</>
            : `Met Office radar at ${hhmm(mm.scan)}, carried forward to now${motion}.`}
        </p>
      </>
    );
  } else {
    const rate = (h) => (h.span > 0 ? (h.precip ?? 0) / h.span : h.precipRate ?? 0);
    const first = wetHours[0];
    const peak = wetHours.length ? wetHours.reduce((a, b) => (rate(b) > rate(a) ? b : a)) : null;
    const heaviest = !peak || peak === first || peak === hs[0] ? '' : `, heaviest around ${hhmm(peak.t)}`;
    const head = !wetHours.length ? 'No rain in the next 12 hours.' : nowWet
      ? `${condLabel(model.now.cond, true)} now${heaviest}.`
      : `${condLabel(first.cond, first.isDay)} from about ${hhmm(first.t)}${heaviest}.`;
    const total = hs.reduce((s, h) => s + (h.span > 0 ? h.precip ?? 0 : 0), 0);
    const hh = hover != null ? hs[hover] : null;
    body = (
      <>
        <p className="lw-summary lw-psum">{head}</p>
        <div className="lw-pchart" onPointerMove={pick(hs)} onPointerDown={pick(hs)} onPointerLeave={() => setHover(null)}
          role="img" aria-label={`Rain each hour for the next 12 hours. ${head}`}>
          <PrecipGuides />
          <div className="lw-pbars is-hours" ref={barsRef}>
            {hs.map((h, k) => {
              const r = rate(h);
              const snowy = (h.snow ?? 0) > (h.precip ?? 0) / 2;
              return <i key={h.t} className={`${r < 0.05 ? 'is-dry' : snowy ? 'is-snow' : ''}${hover === k ? ' is-on' : ''}`} style={{ height: `${Math.max(r < 0.05 ? 2 : 4, barHeight(r) * 100)}%` }} />;
            })}
          </div>
        </div>
        <div className="lw-phours">
          {hs.map((h, k) => (
            <span key={h.t}><b>{k === 0 ? 'Now' : String(hourOf(h.t)).padStart(2, '0')}</b>{h.pRain >= 10 ? <em>{h.pRain}%</em> : ' '}</span>
          ))}
        </div>
        <p className="lw-pnote">
          {hh ? <><b>{hhmm(hh.t)}</b> · {condLabel(hh.cond, hh.isDay)} · {rate(hh).toFixed(1)} mm/h{hh.pRain != null ? ` · ${hh.pRain}% chance within 10 km` : ''}</>
            : total >= 0.1 ? `About ${total >= 10 ? Math.round(total) : total.toFixed(1)} mm in the next 12 hours (Met Office UKV). The % is the chance of rain within 10 km.`
              : 'Met Office UKV. The % is the chance of rain within 10 km.'}
        </p>
      </>
    );
  }
  return (
    <div className="lw-glass lw-card">
      <div className="lw-title">
        <CloudRain />Precipitation
        {mm && (
          <span className="lw-seg lw-seg-sm" role="group" aria-label="Precipitation view" style={{ marginLeft: 'auto' }}>
            <button type="button" aria-pressed={v === 'hour'} onClick={() => { setView('hour'); setHover(null); }}>Next hour</button>
            <button type="button" aria-pressed={v === 'day'} onClick={() => { setView('day'); setHover(null); }}>12 hours</button>
          </span>
        )}
      </div>
      {body}
    </div>
  );
}

/* ── the days ─────────────────────────────────────────────────────────────── */
/* the part of a warning that falls on a day: "10:00–21:00", "from 18:00", "until 06:00" or "all day" */
function warningHours(w, day) {
  const s = ukDay(w.startMs) === day ? hhmm(w.startMs) : null;
  const e = ukDay(w.endMs - 1) === day ? hhmm(w.endMs) : null;
  return s && e ? `${s}–${e}` : s ? `from ${s}` : e ? `until ${e}` : 'all day';
}
const onDay = (w, day) => w.startMs && w.endMs && ukDay(w.startMs) <= day && ukDay(w.endMs - 1) >= day;

function DaysCard({ model, T, dayIdx, onDay: pick, warnings, onWarning }) {
  const ds = model.days.filter((d) => d.hi != null);
  const gLo = Math.min(...ds.map((d) => d.lo)), gHi = Math.max(...ds.map((d) => d.hi));
  const span = Math.max(1, gHi - gLo);
  const nowT = model.now.t2;
  return (
    <div className="lw-glass lw-card">
      <div className="lw-title"><CalendarDays />{ds.length}-day forecast<span className="lw-title-aside">Met Office UKV</span></div>
      {ds.map((d) => {
        const i = model.days.indexOf(d);
        const on = i === dayIdx;
        const left = ((d.lo - gLo) / span) * 100, width = Math.max(4, ((d.hi - d.lo) / span) * 100);
        const ws = warnings.filter((w) => onDay(w, d.day));                   // most severe first already
        return (
          /* The selected day and its description are one highlighted block: the description used to
             hang underneath the highlight, outside it, looking like part of the next row. */
          <div key={d.day} className={`lw-dayrow${on ? ' is-on' : ''}`}>
            <button type="button" className="lw-day" onClick={() => pick(i)} aria-pressed={on} aria-expanded={on}>
              <span className="lw-day-name">{d.label}</span>
              <span className="lw-day-icon">
                <WxIcon cond={d.cond} day windy={d.windy} size={30} title={condLabel(d.cond, true, d.windy)} />
                {d.pRain != null && d.pRain >= 20 && isWet(d.cond) ? <b>{d.pRain}%</b> : null}
                {ws.length > 0 && (
                  <span className="lw-day-warn" style={{ background: severityFill(ws[0].severity), color: severityInk(ws[0].severity) }}
                    title={ws.map((w) => `${warningName(w)} ${warningHours(w, d.day)}`).join('; ')}>
                    <AlertTriangle size={9} strokeWidth={3} />
                  </span>
                )}
              </span>
              <span className="lw-day-lo">{Math.round(T(d.lo))}°</span>
              <span className="lw-range">
                <i style={{ left: `${left}%`, width: `${width}%`, background: `linear-gradient(90deg, ${tempColour(d.lo)}, ${tempColour(d.hi)})` }} />
                {d.isToday && nowT != null && <em style={{ left: `${Math.min(100, Math.max(0, ((nowT - gLo) / span) * 100))}%` }} />}
              </span>
              <span className="lw-day-hi">{Math.round(T(d.hi))}°</span>
            </button>
            {on && (
              <div className="lw-day-detail">
                <p className="lw-day-text">{dayText(d)}</p>
                <div className="lw-day-facts">
                  {ws.map((w) => {
                    const Icon = warningIcon(w.type);
                    return (
                      <button key={w.id} type="button" className="lw-day-fact is-warn" onClick={() => onWarning(w.id)}
                        style={{ background: severityFill(w.severity), color: severityInk(w.severity) }}>
                        <Icon size={13} strokeWidth={2.4} />{w.severity} {String(w.type).toLowerCase()} warning · {warningHours(w, d.day)}
                      </button>
                    );
                  })}
                  {d.pRain != null && d.pRain >= 20 && <span className="lw-day-fact"><Umbrella size={13} />{d.pRain}% chance of rain</span>}
                  {d.sun.rise && <span className="lw-day-fact"><Sunrise size={13} />{hhmm(d.sun.rise)}</span>}
                  {d.sun.set && <span className="lw-day-fact"><Sunset size={13} />{hhmm(d.sun.set)}</span>}
                  {d.partial && <span className="lw-day-fact">Part day: the end of the UKV run</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── the top bar's "more" menu: units, a link to this place, and (admins) the sky preview ── */
function BarMenu({ unit, setUnit, link, isAdmin, previewOn, onPreview }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="lw-menu-wrap" ref={ref}>
      <button type="button" className="lw-bar-btn" aria-haspopup="menu" aria-expanded={open} aria-label="More options" onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal size={20} />
      </button>
      {open && (
        <div className="lw-glass lw-menu" role="menu">
          <div className="lw-menu-row is-static">
            <Thermometer size={16} />Units
            <div className="lw-seg" role="group" aria-label="Temperature unit" style={{ marginLeft: 'auto' }}>
              <button type="button" aria-pressed={unit === 'C'} onClick={() => setUnit('C')}>°C</button>
              <button type="button" aria-pressed={unit === 'F'} onClick={() => setUnit('F')}>°F</button>
            </div>
          </div>
          {link && (
            <button type="button" role="menuitem" className="lw-menu-row" onClick={copy}>
              {copied ? <Check size={16} /> : <Link2 size={16} />}{copied ? 'Link copied' : 'Copy a link to this place'}
            </button>
          )}
          {isAdmin && (
            <button type="button" role="menuitem" className="lw-menu-row" onClick={() => { setOpen(false); onPreview(); }}>
              <Palette size={16} />{previewOn ? 'Close the sky preview' : 'Sky preview'}<span className="lw-menu-tag">Admin</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function LocationForecast() {
  const routerLocation = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  /* a link naming a place starts loading at once, rather than flashing the search page first */
  const [loading, setLoading] = useState(() => { const q = new URLSearchParams(routerLocation.search); return q.has('location') || q.has('lat'); });
  const [error, setError] = useState(null);
  const [resp, setResp] = useState(null);
  const [place, setPlace] = useState(null);
  const [outside, setOutside] = useState(null);
  const [dayIdx, setDayIdx] = useState(0);
  const [tick, setTick] = useState(0);
  const [unit, setUnit] = useState(() => { try { return localStorage.getItem('lw-unit') === 'F' ? 'F' : 'C'; } catch { return 'C'; } });
  useEffect(() => { try { localStorage.setItem('lw-unit', unit); } catch { /* storage blocked */ } }, [unit]);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [recent, setRecent] = useState([]);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [openWarn, setOpenWarn] = useState(null);
  /* a warning's bar on the hourly forecast, or its chip on a day, opens its card above */
  const showWarning = useCallback((id) => {
    setOpenWarn(id);
    /* after the card has opened: while it grows, the browser's scroll anchoring shifts the page
       by the growth, which left the card's top under the search bar */
    setTimeout(() => document.getElementById(`lw-warn-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 280);
  }, []);
  /* admins can preview every sky (components/location/SkyPreview.jsx) */
  const [isAdmin, setIsAdmin] = useState(false);
  const [preview, setPreview] = useState(null);
  const [hidePage, setHidePage] = useState(false);
  useEffect(() => { isCurrentUserAdmin().then((a) => setIsAdmin(!!a)).catch(() => {}); }, []);
  const userRef = useRef(null);
  const abortRef = useRef(null);
  const stripRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await currentUser();
      if (cancelled) return;
      setUser(me); userRef.current = me; setAuthChecked(true);
      if (me) { const list = await loadRecent(me); if (!cancelled) setRecent(list); }
    })();
    return () => { cancelled = true; };
  }, []);

  /* one search at a time: a newer one aborts the older */
  const run = useCallback(async (p, { quiet = false } = {}) => {
    const name = (p?.name || '').trim();
    const hasCoords = Number.isFinite(p?.lat) && Number.isFinite(p?.lon);
    if (!name && !hasCoords) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    if (!quiet) { setLoading(true); setError(null); setOutside(null); setGeoError(''); }
    try {
      const body = await fetchLocation({ lat: p.lat, lon: p.lon, name }, ac.signal);
      if (ac.signal.aborted) return;
      if (body.code === 'OUTSIDE_UK') { if (!quiet) setOutside({ query: name || body.resolvedName, country: body.resolvedCountry }); return; }
      setResp(body);
      setPlace({ name: body.location.name, lat: body.location.lat, lon: body.location.lon, region: p.region || '' });
      if (!quiet) {
        setDayIdx(0);
        rememberSearch(userRef.current, { name: body.location.name, region: p.region || '', lat: body.location.lat, lon: body.location.lon })
          .then((list) => { if (list) setRecent(list); });
      }
    } catch (e) {
      if (e?.name !== 'AbortError' && !quiet) setError(e?.message || 'Could not load the forecast. Please try again shortly.');
    } finally {
      if (!quiet && !ac.signal.aborted) setLoading(false);
    }
  }, []);

  /* keep it current: re-read every five minutes, and re-derive "now" (and the next hour) every minute */
  useEffect(() => {
    if (!place) return undefined;
    const a = setInterval(() => run(place, { quiet: true }), REFRESH_MS);
    const b = setInterval(() => setTick((x) => x + 1), 60e3);
    return () => { clearInterval(a); clearInterval(b); };
  }, [place, run]);

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) { setGeoError('This browser cannot share a location.'); return; }
    setLocating(true); setGeoError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(false); run({ lat: pos.coords.latitude, lon: pos.coords.longitude }); },
      () => { setLocating(false); setGeoError('Location unavailable: permission was declined or the request timed out.'); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }, [run]);

  /* a link opens a place: ?lat=&lon=&name= exactly (the "copy a link" menu item), or ?location=Name */
  useEffect(() => {
    const q = new URLSearchParams(routerLocation.search);
    const la = Number(q.get('lat')), lo = Number(q.get('lon'));
    if (q.has('lat') && q.has('lon') && Number.isFinite(la) && Number.isFinite(lo)) {
      setQuery(q.get('name') || '');
      run({ lat: la, lon: lo, name: q.get('name') || '' });
    } else if (q.get('location')) {
      setQuery(q.get('location'));
      run({ name: q.get('location') });
    }
  }, [routerLocation.search, run]);

  const lat = place?.lat, lon = place?.lon;
  useEffect(() => {
    let cancelled = false;
    setWarnings([]); setOpenWarn(null);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
    fetchAllWarningsForPoint(lat, lon).then((list) => { if (!cancelled) setWarnings(list); });
    return () => { cancelled = true; };
  }, [lat, lon]);

  const model = useMemo(() => {
    if (!resp) return null;
    try { return shape(resp); } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resp, tick]);
  const T = useCallback((c) => (c == null ? null : unit === 'F' ? (c * 9) / 5 + 32 : c), [unit]);
  const deg = (c) => (c == null ? '—' : `${Math.round(T(c))}°`);

  /* back from a forecast goes to the search; from the search, to the previous page */
  const backOut = () => {
    if (!model) { navigate(-1); return; }
    abortRef.current?.abort();
    setResp(null); setPlace(null); setQuery(''); setError(null);
  };

  const pickDay = (i) => {
    setDayIdx(i);
    const d = model?.days[i];
    const el = d && stripRef.current?.querySelector(`[data-day="${d.day}"]`);
    if (el && stripRef.current) stripRef.current.scrollTo({ left: el.offsetLeft - 8, behavior: 'smooth' });
  };

  /* the sky: the weather now at the place, or a mild default before a search */
  const sky = useMemo(() => {
    if (preview) return previewSky(preview);
    if (model) {
      const n = model.now;
      return { cond: n.cond, sun: n.sun, morning: hourOf(Date.now()) < 12, wind: n.wind ?? 8, wdir: n.wdir ?? 240, rate: n.span > 0 ? (n.precip ?? 0) / n.span : n.precipRate ?? 0, cloud: n.tcc ?? 60 };
    }
    const sun = sunElevation(Date.now(), 52.5, -1.5);
    return { cond: 'partly', sun, morning: hourOf(Date.now()) < 12, wind: 10, wdir: 240, rate: 0, cloud: 45 };
  }, [model, preview]);
  const togglePreview = () => {
    setHidePage(false);
    setPreview((p) => (p ? null : { ...PREVIEW_START, cond: model?.now.cond || PREVIEW_START.cond }));
  };
  const dark = skyDarkness(sky.cond, sky.sun);
  const today = model?.days[0];
  const runs = model?.runs || [];

  return (
    <div className="lw-page" data-sky={dark < 0.3 ? 'bright' : dark < 0.55 ? 'mid' : 'dark'}>
      <SkyBackdrop {...sky} />
      {model && !hidePage && <CardRain cond={sky.cond} rate={sky.rate} wind={sky.wind} wdir={sky.wdir} />}
      {model && !hidePage && <WindowRain cond={sky.cond} rate={sky.rate} wind={sky.wind} wdir={sky.wdir} />}

      {outside && (
        <div role="dialog" aria-modal="true" aria-labelledby="lw-out" onClick={() => setOutside(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(0,0,0,0.45)' }}>
          <div className="lw-glass lw-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380, textAlign: 'center', padding: 22 }}>
            <h2 id="lw-out" style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Only the UK and Ireland are covered</h2>
            <p style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.5, margin: 0 }}>
              &ldquo;{outside.query}&rdquo;{outside.country ? <> is in <b>{outside.country}</b></> : ' is outside the area'}. This forecast comes from the Met Office UKV model, which covers the UK and Ireland.
            </p>
            <button type="button" className="lw-chip" aria-pressed="true" style={{ marginTop: 16 }} onClick={() => setOutside(null)} autoFocus>Search somewhere else</button>
          </div>
        </div>
      )}

      {preview && (
        <SkyPreview value={preview} onChange={setPreview} onClose={togglePreview} hidePage={hidePage} onHidePage={setHidePage} />
      )}

      {/* one glass bar: back, the search, my location, and a menu for the rest */}
      <div className="lw-head" style={hidePage ? { visibility: 'hidden' } : undefined}>
        <div className="lw-bar">
          <button type="button" className="lw-bar-btn" onClick={backOut} aria-label={model ? 'Back to search' : 'Back'}>
            <ChevronLeft size={22} />
          </button>
          {model || loading || error ? (
            <div className="lw-bar-search">
              <LocationSearchBox size="bar" value={query} onChange={setQuery} onSearch={(p) => run(p)} loading={loading} />
            </div>
          ) : (
            <div className="lw-bar-title">Location weather</div>
          )}
          <span className="lw-bar-sep" aria-hidden="true" />
          <button type="button" className="lw-bar-btn" onClick={useMyLocation} aria-label="Use my location" title="Use my location">
            {locating ? <Loader2 size={18} className="animate-spin" /> : <LocateFixed size={18} />}
          </button>
          <BarMenu unit={unit} setUnit={setUnit} isAdmin={isAdmin} previewOn={!!preview} onPreview={togglePreview}
            link={model ? `${window.location.origin}/LocationWeather?lat=${model.lat.toFixed(4)}&lon=${model.lon.toFixed(4)}&name=${encodeURIComponent(model.location.name)}` : null} />
        </div>
      </div>

      <div className="lw-wrap" style={hidePage ? { display: 'none' } : undefined}>
        {error && <div className="lw-error" role="alert">{error}</div>}
        {geoError && model && <div className="lw-error" role="alert">{geoError}</div>}

        {loading && !model && (
          <div className="lw-loading"><div className="lw-spinner" /><span>Reading the Met Office UKV forecast…</span></div>
        )}

        {!model && !loading && (
          <LocationLanding
            query={query} onQueryChange={setQuery}
            onSearch={(p) => { if (p?.name) setQuery(p.name); run(p); }}
            loading={loading} recent={recent}
            onForget={async (r) => { const list = await forgetSearch(user, r); if (list) setRecent(list); }}
            onClearAll={async () => { const list = await clearRecent(user); if (list) setRecent(list); }}
            user={user} authChecked={authChecked}
            onUseMyLocation={useMyLocation} locating={locating} geoError={geoError} unit={unit}
          />
        )}

        {model && (
          <>
            <header className="lw-hero" aria-live="polite">
              <div className="lw-hero-name">{model.location.name}</div>
              <div className="lw-hero-temp">{deg(model.now.t2)}</div>
              <div className="lw-hero-cond">{condLabel(model.now.cond, model.now.isDay, model.now.windy)}</div>
              {today && <div className="lw-hero-hl">H:{deg(today.hi)}&nbsp;&nbsp;L:{deg(today.lo)}</div>}
              <div className="lw-hero-meta">
                Feels like {deg(model.now.feels)}
                {model.analysis?.valid ? ` · observed analysis ${hhmm(Date.parse(model.analysis.valid))}` : ''}
              </div>
            </header>

            {warnings.length > 0 && (
              <div className="lw-glass lw-card" style={{ marginBottom: 14 }}>
                <div className="lw-title"><AlertTriangle />Weather warnings<span className="lw-title-aside">{warnings.length === 1 ? '1 for this place' : `${warnings.length} for this place`}</span></div>
                <LocationWarnings warnings={warnings} openId={openWarn} onToggle={setOpenWarn} />
              </div>
            )}

            <div className="lw-grid">
              <div className="lw-col">
                <HourlyCard model={model} T={T} stripRef={stripRef} warnings={warnings} onWarning={showWarning} />
                <PrecipCard model={model} />
                <DaysCard model={model} T={T} dayIdx={dayIdx} onDay={pickDay} warnings={warnings} onWarning={showWarning} />
                <div className="lw-glass lw-card">
                  <div className="lw-title"><Radar />Rain radar<span className="lw-title-aside">Met Office 1 km · then UKV</span></div>
                  <LocationRadar lat={model.lat} lon={model.lon} />
                </div>
              </div>
              <div className="lw-col">
                <LocationTiles model={model} unit={unit} />
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <LocationCharts model={model} unit={unit} dayIdx={dayIdx} onDay={pickDay} />
            </div>

            <p className="lw-source">
              Forecast: Met Office UKV 2 km model from the Met Office&rsquo;s open data on AWS
              {runs.length ? ` — ${runs.map((r) => `${runName(r.run)} run to T+${r.top}`).join(', then ')}` : ''}.
              {model.cell ? ` The nearest model grid point is ${model.cell.offset_km} km away.` : ''}
              <br />Now: the UKV analysed every 15 minutes with station reports, the cloud Meteosat sees and the radar&rsquo;s rain. Radar: Met Office 1 km composite.
              The next hour: the newest radar scan carried forward by the way the rain has moved over the last half hour.
              Chance of rain counts model rain within 10 km; chance of lightning within 16 km.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
