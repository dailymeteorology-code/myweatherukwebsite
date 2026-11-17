/* Location Weather.

   One place's weather from the Met Office UKV 2 km model on AWS (server/locationWeather.js),
   in liquid glass over a live animated sky:
     • the hero: the temperature now, from the 15-minute UKV + station analysis
     • weather warnings whose area covers the place
     • the Today card: the forecast in words for today, tonight and tomorrow, and the few things that
       matter most today as chips to their cards, which also come up the page on a phone (TodayCard.jsx,
       src/lib/location/forecastText.js)
     • the hourly strip to T+120 (hourly to T+54, then three-hourly, as UKV publishes); tapping an hour
       opens the hour sheet with everything for it (HourSheet.jsx), and a link can open one directly:
       …&at=2026-11-21T15:00 (UK time), …&card=radar to go to a card
     • precipitation, when there is any: the next hour minute by minute (the Met Office radar
       carried forward by the rain's own motion), or the next 12 hours from UKV
     • rain splashing on the top row of cards while it rains (CardRain in SkyBackdrop.jsx; the warnings
       card when there is one), snow settling on them while it snows (CardSnow), frost on the glass
       below freezing, more of it and on more cards the colder it is (CardFrost), and drops on every
       card's glass, as on a window (WindowRain)
     • the days, with their ranges on one shared scale
     • the Met Office radar for the past three hours and UKV rain for the next hours
     • fourteen detail tiles and ten interactive charts
   The route key stays "LocationWeather" (pages.config.js), so every old link still works;
   ?location=Name opens a place directly. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUnits } from '@/components/useUnits';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Clock3, CalendarDays, Radar, AlertTriangle, CloudRain, ChevronLeft, ChevronRight, ChevronDown, Loader2, Palette, LocateFixed, MoreHorizontal, Link2, Thermometer, Check,
  Umbrella, Sunrise, Sunset, Zap, Snowflake, Sun, Moon, Wind, Droplets, Eye, Play, Share2, Share, Smartphone, WifiOff,
} from 'lucide-react';
import LocationThunder from '@/components/location/LocationThunder';
import LocationSnow from '@/components/location/LocationSnow';
import LocationSearchBox from '@/components/location/LocationSearchBox';
import LocationLanding from '@/components/location/LocationLanding';
import LocationWarnings, { warningIcon, warningName, warningSpan, severityFill, severityInk } from '@/components/location/LocationWarnings';
import LocationRadar from '@/components/location/LocationRadar';
import LocationTiles from '@/components/location/LocationTiles';
import LocationCharts, { tempColour } from '@/components/location/LocationCharts';
import SkyBackdrop, { CardFrost, CardRain, CardSnow, WindowRain, CardMist, CardFog, skyDarkness } from '@/components/location/SkyBackdrop';
import SkyPreview, { PREVIEW_START, previewSky } from '@/components/location/SkyPreview';
import TodayCard from '@/components/location/TodayCard';
import SituationCards from '@/components/location/SituationCards';
import EverydayIndices from '@/components/location/EverydayIndices';
import StormWatch from '@/components/location/StormWatch';
import { SaveStar, PlacesStrip, CompareSheet, CommuteCard } from '@/components/location/YourPlaces';
import { loadPlaces, savePlaces, placeWith, samePlace, localPlaces } from '@/lib/location/places';
import HourSheet, { hourFor, momentParam, parseMoment } from '@/components/location/HourSheet';
import { mattersToday } from '@/lib/location/forecastText';
import TimeTravel from '@/components/location/TimeTravel';
import StoryMode from '@/components/location/StoryMode';
import ShareSheet from '@/components/location/ShareSheet';
import { travelModel, travelSteps, dayRange, travelLabel } from '@/lib/location/travel';
import { useInstall, useLocationApp } from '@/lib/location/app';
import { useOutside, AlertsCard, CoastCard } from '@/components/location/OutsideCards';
import TrendCard from '@/components/location/TrendCard';
import { ACTIVITIES, scoreHours, goodSpells } from '@/lib/everydayIndices';
import { compareWords } from '@/lib/location/outside';
import { fetchKp } from '@/lib/location/feeds';
import { SHOWERS, auroraKp } from '@/lib/location/situations';
import { isCurrentUserAdmin } from '@/lib/tcmFetchPolicy';
import WxIcon from '@/components/location/WxIcon';
import '@/components/location/location.css';
import { currentUser, loadRecent, rememberSearch, forgetSearch, clearRecent } from '@/lib/locationHistory';
import { fetchAllWarningsForPoint } from '@/lib/locationWarnings';
import {
  fetchLocation, shape, condLabel, isWet, nextHoursText, hhmm, hourOf, sunElevation, compass,
  minutelyText, wetMinute, bandOf, ukDay, thunderRisk, fromThisHour, quartersOf, snowChance, SNOW_CHANCE, dayText,
  PRECIP_KINDS, KIND_KEYS, rateOf, sourceName, cachedLocation, uvWord, visWord, cachedLocationAny, lastOpenedPlace, dayLabel,
} from '@/lib/ukvLocation';
import { snowRiskLevel, cmText } from '@/lib/frostKey';

const REFRESH_MS = 5 * 60e3;                       // a new radar scan every 15 minutes: the next hour follows each one
const runName = (iso) => {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}Z ${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}`;
};

/* ── the hourly strip ────────────────────────────────────────────────────── */
const COL_W = 58;                                  // every column of the strip (.lw-hour, border-box)
const LANE_H = 24;                                 // one warning bar, with its gap
const QUARTER_HOURS = 12;                          // the hours that open into their quarters: the next twelve
/* the best-time finder's activities: Out and about's (src/lib/everydayIndices.js), but cycling, whose score
   needs the way you ride (Out and about asks for it) */
const BEST_FOR = ACTIVITIES.filter(([k]) => k !== 'cycle');
const spellDay = (t) => {
  const d = ukDay(t), today = ukDay(Date.now());
  if (d === today) return 'today';
  if (d === ukDay(Date.now() + 864e5)) return 'tomorrow';
  return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Europe/London' });
};
/* `onHour`: tapping an hour (or one of its quarters) opens the hour sheet for it; `sheetT` marks it.
   `bestFor`: the activity the best-time finder is showing (Phase G, from the user's brainstorm): its
   good hours get a green bar under them across the whole forecast, and its best spells are listed. */
function HourlyCard({ model, T, stripRef, warnings, onWarning, onHour, sheetT, bestFor = null, onBestFor }) {
  const U = useUnits();
  /* the hours opened into their quarters (by the hour's time), and each of the next twelve hours' quarters */
  const [open, setOpen] = useState(() => new Set());
  const toggle = useCallback((t) => setOpen((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; }), []);
  const hs = useMemo(() => fromThisHour(model.full), [model]);
  const quarters = useMemo(() => new Map(hs.slice(0, QUARTER_HOURS + 1).map((h) => [h.t, quartersOf(model, h)])), [model, hs]);
  /* the best-time finder: every waking hour (07:00 to 22:00) scored for the activity (Out and about's rules
     of thumb), the good ones (6 out of 10 or better) marked, and each day's longest good spell listed */
  const best = useMemo(() => {
    if (!bestFor) return null;
    const awake = (t) => { const hr = hourOf(t); return hr >= 7 && hr <= 21; };
    const scored = scoreHours(hs, bestFor).map((x) => (awake(x.t) ? x : { ...x, score: 0 }));
    const span = new Map(hs.map((h) => [h.t, Math.max(1, h.span || 1)]));
    /* a spell ends with its last good hour (a three-hourly step ends three hours on), and by 22:00 */
    const endOf = (sp) => { const d = ukDay(sp.from); let e = sp.to + span.get(sp.to) * 36e5; while (e - 36e5 > sp.from && (ukDay(e - 1) !== d || hourOf(e - 1) >= 22)) e -= 36e5; return e; };
    const spells = goodSpells(scored).map((sp) => { const end = endOf(sp); return { ...sp, end, hours: (end - sp.from) / 36e5 }; });
    const byDay = new Map();
    for (const sp of spells) {
      const d = ukDay(sp.from), cur = byDay.get(d);
      if (!cur || sp.hours > cur.hours || (sp.hours === cur.hours && sp.best > cur.best)) byDay.set(d, sp);
    }
    return { score: new Map(scored.map((x) => [x.t, x.score])), days: [...byDay.values()].sort((a, b) => a.from - b.from) };
  }, [hs, bestFor]);
  const items = useMemo(() => {
    if (!hs.length) return [];
    const from = hs[0].t, to = hs[hs.length - 1].t;
    const suns = [];
    for (const d of model.days) {
      if (d.sun.rise && d.sun.rise > from && d.sun.rise < to) suns.push({ sun: 'Sunrise', t: d.sun.rise, o: 2 });
      if (d.sun.set && d.sun.set > from && d.sun.set < to) suns.push({ sun: 'Sunset', t: d.sun.set, o: 2 });
    }
    const qs = [];
    for (const h of hs) if (open.has(h.t)) for (const q of quarters.get(h.t) || []) qs.push({ q, t: q.t, o: 1, of: h.t });
    /* a sunrise or sunset in an hour that is open belongs with its quarters */
    for (const sn of suns) { const h = hs.find((x) => open.has(x.t) && sn.t >= x.t && sn.t < x.t + 36e5); if (h) sn.of = h.t; }
    /* where the hours go on past the UKV's end (to the last day of the outlook): a slim column naming
       the model they come from, three- and six-hourly from there */
    const first = hs.find((h) => h.ext);
    const mark = first ? [{ srcMark: first.src, t: first.t - 1, o: -1 }] : [];
    /* in time; an hour before its own quarters, a sunrise among the quarters it falls in */
    return [...hs.map((h) => ({ h, t: h.t, o: 0 })), ...suns, ...qs, ...mark].sort((a, b) => a.t - b.t || a.o - b.o);
  }, [model, hs, open, quarters]);
  /* Each warning as a bar in its colour under exactly the columns it covers: an hour column covers
     its hour (three hours beyond T+54), a quarter its fifteen minutes, a sunrise or sunset column its
     moment. One lane per warning, the most severe on top; the label stays in view while the bar is
     scrolled through. */
  const lanes = useMemo(() => {
    if (!items.length) return [];
    const out = [];
    for (const w of warnings) {
      if (!w.startMs || !w.endMs) continue;
      let a = -1, b = -1;
      items.forEach((it, k) => {
        const t0 = it.t, t1 = it.h ? it.t + Math.max(1, it.h.span || 1) * 3600e3 : it.q ? it.t + 15 * 60e3 : it.t + 1;
        if (t0 < w.endMs && t1 > w.startMs) { if (a < 0) a = k; b = k; }
      });
      if (a < 0) continue;
      out.push({ w, a, b, openStart: w.startMs < items[0].t, openEnd: w.endMs > items[items.length - 1].t + 3600e3 });
    }
    return out;
  }, [items, warnings]);
  const scroll = (dir) => stripRef.current?.scrollBy({ left: dir * stripRef.current.clientWidth * 0.8, behavior: 'smooth' });
  const anyThunder = items.some((it) => thunderRisk((it.h || it.q)?.nova?.p));
  const anySnow = items.some((it) => snowChance((it.h || it.q)?.snowCond));
  const anyOpen = open.size > 0;
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
      <p className="lw-summary">{nextHoursText(model, U)}</p>
      {onBestFor && (
        <div className="lw-best">
          <span className="lw-best-label">Best time for</span>
          <div className="lw-best-chips" role="group" aria-label="Find the best time for">
            {BEST_FOR.map(([k, l]) => (
              <button key={k} type="button" className="lw-chip" aria-pressed={bestFor === k} onClick={() => onBestFor(bestFor === k ? null : k)}>{l}</button>
            ))}
          </div>
          {best && (
            <p className="lw-best-say" aria-live="polite">
              {best.days.length
                ? <>Best {best.days.slice(0, 5).map((sp, i, list) => <span key={sp.from}>{i ? (i === list.length - 1 ? ' and ' : ', ') : ''}<b>{spellDay(sp.from)} {hhmm(sp.from)}–{hhmm(sp.end)}</b></span>)}.</>
                : <>No good spell between 07:00 and 22:00 in the forecast.</>}
              {' '}Every good hour has green under it.
            </p>
          )}
        </div>
      )}
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
          if (it.srcMark) {
            return (
              <div key={`m${it.t}`} className="lw-hour lw-h-mark" title={`From here: ${sourceName(it.srcMark)}, every three or six hours`}>
                <span className="lw-h-day" />
                <span className="lw-h-time">then</span>
                <span className="lw-src-tag">{sourceName(it.srcMark).replace('Met Office ', 'MO ')}</span>
                <span className="lw-src-sub">3–6 hourly</span>
              </div>
            );
          }
          if (it.sun) {
            return (
              <div key={`s${it.t}`} className={`lw-hour${it.of ? ' is-quarter' : ''}${it.of && items[k + 1]?.of !== it.of ? ' is-qend' : ''}`}>
                <span className="lw-h-day" />
                <span className="lw-h-time">{hhmm(it.t)}</span>
                <WxIcon cond={it.sun === 'Sunrise' ? 'sunrise' : 'sunset'} day size={30} title={it.sun} />
                <span className="lw-h-pop" />
                <span className="lw-h-temp" style={{ fontSize: 13, fontWeight: 600 }}>{it.sun}</span>
              </div>
            );
          }
          /* a quarter hour of an hour opened (quartersOf): its own time, weather, temperature and wind */
          const q = it.q;
          const h = it.h || q, w = k === 0 ? model.now : h;   // "Now" shows the wind now, as it does the weather and temperature
          const pop = h.pRain != null && h.pRain >= 20 && isWet(h.cond) ? `${h.pRain}%` : h.pRain >= 40 ? `${h.pRain}%` : '';
          const ts = thunderRisk(h.nova?.p);
          const sc = snowChance(h.snowCond);
          const qs = !q && quarters.get(h.t);
          const isOpen = !q && open.has(h.t);
          const lastQ = q && items[k + 1]?.of !== it.of;
          const label = k === 0 ? 'Now' : q ? hhmm(q.t) : h.span > 1 ? hhmm(h.t) : String(hourOf(h.t)).padStart(2, '0');
          const hourT = q ? it.of : h.t;   // a quarter opens the sheet of the hour it belongs to
          const open1 = () => onHour?.(hourT);
          return (
            <div key={q ? `q${q.t}` : h.t}
              className={`lw-hour is-tap${k === 0 ? ' is-now' : ''}${dayStart ? ' is-day-start' : ''}${q ? ' is-quarter' : ''}${lastQ ? ' is-qend' : ''}${isOpen ? ' is-open' : ''}${!q && sheetT === h.t ? ' is-sel' : ''}${!q && best ? ((best.score.get(h.t) ?? 0) >= 0.8 ? ' is-best is-ideal' : (best.score.get(h.t) ?? 0) >= 0.6 ? ' is-best' : '') : ''}`}
              data-day={q ? undefined : h.day} data-t={q ? undefined : h.t}
              role="button" tabIndex={0} onClick={open1}
              onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open1(); } }}
              aria-label={`${k === 0 ? 'Now' : `${day} ${hhmm(q ? q.t : h.t)}`}: everything for this hour`}>
              <span className="lw-h-day">{dayStart ? day : ''}</span>
              <span className="lw-h-time">
                {label}
                {qs?.length > 0 && (
                  /* the quarters: a small arrow pointing right to open them, pointing down to close them */
                  <button type="button" className="lw-qbtn" onClick={(e) => { e.stopPropagation(); toggle(h.t); }} aria-expanded={isOpen}
                    aria-label={`${isOpen ? 'Close' : 'Show'} the ${qs.length === 4 ? '' : 'rest of the '}15-minute forecast for ${k === 0 ? 'this hour' : hhmm(h.t)}`}
                    title={isOpen ? 'Close the 15-minute forecast' : 'Every 15 minutes'}>
                    {isOpen ? <ChevronDown size={12} strokeWidth={2.8} /> : <ChevronRight size={12} strokeWidth={2.8} />}
                  </button>
                )}
              </span>
              <WxIcon cond={k === 0 ? model.now.cond : h.cond} day={k === 0 ? model.now.isDay : h.isDay} windy={k === 0 ? model.now.windy : h.windy} size={q ? 26 : 30}
                title={k === 0 ? condLabel(model.now.cond, model.now.isDay, model.now.windy) : condLabel(h.cond, h.isDay, h.windy)} />
              <span className="lw-h-pop">{pop}</span>
              <span className="lw-h-temp">{Math.round(T(k === 0 ? model.now.t2 : h.t2))}°</span>
              <span className="lw-h-wind" title={`Wind ${U.fmtWind(w.wind)} from the ${compass(w.wdir)}`}>
                <svg width="9" height="9" viewBox="-5 -5 10 10" style={{ transform: `rotate(${(w.wdir ?? 0) + 180}deg)` }}><path d="M0 -5 L3.5 3 L0 1.4 L-3.5 3Z" fill="currentColor" /></svg>
                {Math.round(U.windSpeed(w.wind))}
              </span>
              {anyThunder && (
                <span className="lw-h-ts" style={ts ? { color: ts.colour } : undefined}
                  title={ts ? `${ts.word} thunderstorm risk: ${Math.round(h.nova.p)}% (TCM NOVA)` : undefined}>
                  {ts ? <><Zap size={10} strokeWidth={2.6} fill="currentColor" />{Math.round(h.nova.p)}%</> : ''}
                </span>
              )}
              {anySnow && (
                <span className="lw-h-sc" title={sc ? `Snow chance: ${sc.word} (MyWeatherUK snow conditions index)` : undefined}>
                  {sc ? <b style={{ background: sc.colour, color: sc.ink }}><Snowflake size={9} strokeWidth={2.8} />{sc.short}</b> : ''}
                </span>
              )}
            </div>
          );
        })}
        </div>
      </div>
      {anyThunder && (
        <p className="lw-hours-note"><Zap size={11} strokeWidth={2.6} fill="currentColor" />Thunderstorm risk each hour from <b>MyWeatherUK&rsquo;s TCM NOVA</b></p>
      )}
      {anySnow && (
        <p className="lw-hours-note lw-snow-note">
          <Snowflake size={11} strokeWidth={2.6} />Snow chance each hour from <b>MyWeatherUK&rsquo;s snow conditions index</b>
          <span className="lw-sc-key">{SNOW_CHANCE.map((s) => <i key={s.level} title={s.word} style={{ background: s.colour }} />)}very low to very high</span>
        </p>
      )}
      {!anyOpen && [...quarters.values()].some((x) => x.length) && (
        <p className="lw-hours-note lw-q-hint"><ChevronRight size={12} strokeWidth={2.8} />Tap the arrow by a time for its forecast every 15 minutes (the next 12 hours).</p>
      )}
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
  const U = useUnits();
  const [view, setView] = useState(null);                         // null: the hour when rain is near, else the 12 hours
  const [hover, setHover] = useState(null);
  const barsRef = useRef(null);
  const mm = model.minutely;
  const hs = fromThisHour(model.full).slice(0, 12);
  const wetHours = hs.slice(1).filter((h) => isWet(h.cond));   // the hours to come; the radar speaks for now
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

  /* each bar in the colours of what is falling (rain, mix, sleet, snow or ice: PRECIP_KINDS) */
  const fill = (kind) => { const k = PRECIP_KINDS[kind] || PRECIP_KINDS.rain; return `linear-gradient(180deg, ${k.top}, ${k.bottom})`; };
  const kindWord = (kind) => (PRECIP_KINDS[kind]?.long || PRECIP_KINDS[kind]?.name || 'Rain').toLowerCase();
  let body, shown = [];
  if (v === 'hour') {
    const { mins } = mm;
    const word = (b, kind) => (b ? `${BAND_WORDS[b]} ${kindWord(kind)}` : 'Dry');
    const hm = hover != null ? mins[hover] : null;
    const motion = mm.motion && mm.motion.kmh >= 3 ? `, the rain moving ${HEADING[Math.round(mm.motion.towards / 45) % 8]} at ${U.fmtWind(mm.motion.kmh / 1.609344)}` : '';
    shown = [...new Set(mins.filter((m) => m.rate >= 0.1).map((m) => m.kind))];
    body = (
      <>
        <p className="lw-summary lw-psum">{minutelyText(mm, nowLabel)}</p>
        <div className="lw-pchart" onPointerMove={pick(mins)} onPointerDown={pick(mins)} onPointerLeave={() => setHover(null)}
          role="img" aria-label={`Precipitation each minute for the next hour. ${minutelyText(mm, nowLabel)}`}>
          <PrecipGuides />
          <div className="lw-pbars" ref={barsRef}>
            {mins.map((m) => (
              <i key={m.t} className={m.rate < 0.1 ? 'is-dry' : ''}
                style={{ height: `${Math.max(m.rate < 0.1 ? 1.5 : 4, barHeight(m.rate) * 100)}%`, opacity: m.rate < 0.1 ? 1 : 0.4 + 0.6 * (m.chance / 100), ...(m.rate >= 0.1 ? { background: fill(m.kind) } : {}) }} />
            ))}
            {hover != null && <b className="lw-pcursor" style={{ left: `${((hover + 0.5) / mins.length) * 100}%` }} />}
          </div>
        </div>
        <div className="lw-paxis"><span>Now</span><span>15 min</span><span>30 min</span><span>45 min</span><span>{mins.length > 55 ? '60 min' : `${mins.length - 1} min`}</span></div>
        <p className="lw-pnote">
          {hm ? <><b>{hhmm(hm.t)}</b> · {word(bandOf(hm.rate), hm.kind)}{hm.rate >= 0.1 ? ` · ${U.fmtRate(hm.rate)} · ${hm.chance}% chance` : ''}</>
            : `Met Office radar at ${hhmm(mm.scan)}, carried forward to now${motion}.`}
        </p>
      </>
    );
  } else {
    const rate = rateOf;
    const first = wetHours[0];
    const peak = wetHours.length ? wetHours.reduce((a, b) => (rate(b) > rate(a) ? b : a)) : null;
    const heaviest = !peak || peak === first || peak === hs[0] ? '' : `, heaviest around ${hhmm(peak.t)}`;
    const head = !wetHours.length ? 'No rain in the next 12 hours.' : nowWet
      ? `${condLabel(model.now.cond, true)} now${heaviest}.`
      : `${condLabel(first.cond, first.isDay)} from about ${hhmm(first.t)}${heaviest}.`;
    /* an hour's rain is what falls in the hour up to it, so the hour we are in has already fallen */
    const total = hs.slice(1).reduce((s, h) => s + (h.span > 0 ? h.precip ?? 0 : 0), 0);
    const hh = hover == null ? null : hover === 0 ? { ...hs[0], ...model.now } : hs[hover];
    shown = [...new Set(hs.map((h, k) => (k === 0 ? model.now : h)).filter((h) => rate(h) >= 0.05).map((h) => h.kind))];
    body = (
      <>
        <p className="lw-summary lw-psum">{head}</p>
        <div className="lw-pchart" onPointerMove={pick(hs)} onPointerDown={pick(hs)} onPointerLeave={() => setHover(null)}
          role="img" aria-label={`Precipitation each hour for the next 12 hours. ${head}`}>
          <PrecipGuides />
          <div className="lw-pbars is-hours" ref={barsRef}>
            {hs.map((h, k) => {
              const x = k === 0 ? model.now : h;            // "Now": what is falling now (the radar), not the hour's forecast
              const r = rate(x);
              return <i key={h.t} className={`${r < 0.05 ? 'is-dry' : ''}${hover === k ? ' is-on' : ''}`} style={{ height: `${Math.max(r < 0.05 ? 2 : 4, barHeight(r) * 100)}%`, ...(r >= 0.05 ? { background: fill(x.kind) } : {}) }} />;
            })}
          </div>
        </div>
        <div className="lw-phours">
          {hs.map((h, k) => (
            <span key={h.t}><b>{k === 0 ? 'Now' : String(hourOf(h.t)).padStart(2, '0')}</b>{h.pRain >= 10 ? <em>{h.pRain}%</em> : ' '}</span>
          ))}
        </div>
        <p className="lw-pnote">
          {hh ? <><b>{hover === 0 ? 'Now' : hhmm(hh.t)}</b> · {condLabel(hh.cond, hh.isDay)}{rate(hh) >= 0.05 ? ` · ${PRECIP_KINDS[hh.kind]?.name || 'Rain'} ${U.fmtRate(rate(hh))}` : ''}{hh.pRain != null ? ` · ${hh.pRain}% chance within 10 km` : ''}</>
            : total >= 0.1 ? `About ${U.fmtRain(total, total >= 10 ? 0 : 1)} in the next 12 hours (Met Office UKV). The % is the chance of precipitation within 10 km.`
              : 'Met Office UKV. The % is the chance of precipitation within 10 km.'}
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
      {/* the five kinds, each in its own colour: those in the bars now first, and bright */}
      <div className="lw-kinds" aria-label="Colours of the bars">
        {[...KIND_KEYS].sort((a, b) => shown.includes(b) - shown.includes(a)).map((k) => (
          <span key={k} className={shown.includes(k) ? 'is-on' : ''} title={PRECIP_KINDS[k].long || PRECIP_KINDS[k].name}>
            <i style={{ background: fill(k) }} />{PRECIP_KINDS[k].name}
          </span>
        ))}
      </div>
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

/* ── the days, overhauled (15 Nov 2026): the MWUK Mix of the UKV and ICON-EU, then the Met Office
   Global as far as it reaches, each day a Day (06:00-18:00) and a Night (18:00-06:00), with MWUK FROST's
   snow and TCM NOVA's thunderstorm risk (ukvLocation.js outlookOf) ── */
const pctText = (p) => (p == null ? '—' : p < 1 ? '<1%' : `${Math.round(p)}%`);
/* what falls in a part, as the model has it (snow and sleet as the water they melt to; MWUK FROST's line
   gives the snow itself) */
function amountText(p, U) {
  if (!(p.rain >= 0.2)) return 'Dry';
  const mm = U.fmtRain(p.rain, p.rain >= 10 ? 0 : 1);
  return { mix: `${mm} of rain and snow`, sleet: `${mm}, falling as sleet`, snow: `${mm}, falling as snow`, ice: `${mm} of freezing rain` }[p.fallKind] || `${mm} of rain`;
}
function partText(p, isDay, U) {
  const bits = [condLabel(p.cond, isDay, p.windy)];
  if ((p.gust ?? 0) >= 35) bits.push(`gusts ${U.fmtWind(p.gust)}`);
  if (!isDay && p.lo != null && p.lo <= 0) bits.push(p.lo <= -3 ? 'hard frost' : 'frost');
  return bits.join(' · ');
}
function PartPanel({ p, isDay, T, U }) {
  const ts = thunderRisk(p.thunder?.p);
  const fr = p.frost;
  const temp = isDay ? p.hi : p.lo;
  return (
    <div className={`lw-part ${isDay ? 'is-day' : 'is-night'}`}>
      <div className="lw-part-head">
        {isDay ? <Sun size={13} /> : <Moon size={13} />}{isDay ? 'Day' : 'Night'}
        <span>{p.from > p.start ? `now–${hhmm(p.to)}` : `${hhmm(p.from)}–${hhmm(p.to)}`}{p.partial && !(p.from > p.start) ? ' · part' : ''}</span>
      </div>
      <div className="lw-part-main">
        <WxIcon cond={p.cond} day={isDay} windy={p.windy} size={46} title={condLabel(p.cond, isDay, p.windy)} />
        <div className="lw-part-say">
          <div className="lw-part-temp">{isDay ? 'High' : 'Low'} <b>{temp == null ? '—' : `${Math.round(T(temp))}°`}</b></div>
          <div className="lw-part-cond">{partText(p, isDay, U)}</div>
        </div>
      </div>
      <ul className="lw-part-facts">
        <li><Umbrella size={13} /><span><b>{pctText(p.pRain)}</b> chance{p.rain >= 0.2 ? ` · ${amountText(p, U)}` : ''}</span></li>
        {fr && (fr.chance >= 5 || fr.cm >= 0.2) && (
          <li className="is-frost"><Snowflake size={13} /><span>Snow <b>{pctText(fr.chance)}</b>{fr.cm >= 0.2 ? ` · ${cmText(fr.cm)}` : ''} <em>MWUK FROST</em></span></li>
        )}
        {ts && (
          <li><Zap size={13} style={{ color: ts.colour }} /><span><b style={{ color: ts.colour }}>{ts.word}</b> thunderstorm risk · {pctText(p.thunder.p)} <em>TCM NOVA</em></span></li>
        )}
        <li><Wind size={13} /><span>{p.wind == null ? '—' : <>{compass(p.wdir)} <b>{U.fmtWind(p.wind)}</b></>}{p.gust != null ? `, gusts ${U.fmtWind(p.gust)}` : ''}</span></li>
        <li><Thermometer size={13} /><span>Feels like <b>{(isDay ? p.feelsHi : p.feelsLo) == null ? '—' : `${Math.round(T(isDay ? p.feelsHi : p.feelsLo))}°`}</b></span></li>
        {isDay && p.uvi != null && <li><Sun size={13} /><span>UV <b>{Math.round(p.uvi)}</b> {uvWord(p.uvi).toLowerCase()}</span></li>}
        {p.rh != null && <li><Droplets size={13} /><span>Humidity <b>{Math.round(p.rh)}%</b></span></li>}
        {p.vis != null && p.vis < 10 && <li><Eye size={13} /><span>Visibility <b>{visWord(p.vis).toLowerCase()}</b></span></li>}
      </ul>
    </div>
  );
}
function OutlookCard({ model, T, selected, onDay: pick, warnings, onWarning }) {
  const U = useUnits();
  const ol = model.outlook;
  const ds = ol.days;
  const his = ds.map((d) => d.hi).filter((v) => v != null), los = ds.map((d) => d.lo).filter((v) => v != null);
  const gLo = Math.min(...los, ...his), gHi = Math.max(...his, ...los);
  const span = Math.max(1, gHi - gLo);
  const nowT = model.now.t2;
  const sources = [...new Set(ds.flatMap((d) => d.models))];
  return (
    <div className="lw-glass lw-card lw-outlook">
      <div className="lw-title"><CalendarDays />{`${ds.length}-day forecast`}<span className="lw-title-aside">{sources.map(sourceName).join(' · ')}</span></div>
      {ds.map((d) => {
        const on = d.day === selected;
        const lo = d.lo ?? d.hi, hi = d.hi ?? d.lo;
        const left = (((lo ?? gLo) - gLo) / span) * 100, width = Math.max(4, (((hi ?? gHi) - (lo ?? gLo)) / span) * 100);
        const ws = warnings.filter((w) => onDay(w, d.day));                   // most severe first already
        const dp = d.dayPart, np = d.nightPart;
        const lead = dp || np;
        const frostLv = snowRiskLevel(d.frost?.risk);
        const snowy = frostLv || (d.frost?.p0 ?? 0) >= 20;
        const ts = thunderRisk(d.thunder?.p);
        return (
          <div key={d.day} className={`lw-dayrow${on ? ' is-on' : ''}`}>
            <button type="button" className="lw-day lw-day2" onClick={() => pick(on ? null : d.day)} aria-pressed={on} aria-expanded={on}>
              <span className="lw-day-name">{d.label}<small>{d.date}</small></span>
              <span className="lw-day-icon">
                <WxIcon cond={lead.cond} day={!!dp} windy={lead.windy} size={30} title={`${dp ? 'Day' : 'Night'}: ${condLabel(lead.cond, !!dp, lead.windy)}`} />
                {d.pRain >= 20 && (dp ? isWet(dp.cond) : isWet(np.cond)) ? <b>{d.pRain}%</b> : null}
                {ws.length > 0 && (
                  <span className="lw-day-warn" style={{ background: severityFill(ws[0].severity), color: severityInk(ws[0].severity) }}
                    title={ws.map((w) => `${warningName(w)} ${warningHours(w, d.day)}`).join('; ')}>
                    <AlertTriangle size={9} strokeWidth={3} />
                  </span>
                )}
              </span>
              <span className="lw-day-night" title={np ? `Night: ${condLabel(np.cond, false, np.windy)}` : undefined}>
                {dp && np ? <WxIcon cond={np.cond} day={false} windy={np.windy} size={24} /> : null}
              </span>
              <span className="lw-day-flags">
                {snowy && <Snowflake size={13} strokeWidth={2.6} style={{ color: frostLv?.colour || '#e6f2ff' }} aria-label={`MWUK FROST: ${frostLv ? `${frostLv.name} snow risk` : `${d.frost.p0}% chance of snow`}`} />}
                {ts && ts.key !== 'TSTM' && <Zap size={13} strokeWidth={2.6} fill="currentColor" style={{ color: ts.colour }} aria-label={`${ts.word} thunderstorm risk`} />}
              </span>
              <span className="lw-day-lo">{lo == null ? '' : `${Math.round(T(lo))}°`}</span>
              <span className="lw-range">
                <i style={{ left: `${left}%`, width: `${width}%`, background: `linear-gradient(90deg, ${tempColour(lo ?? gLo)}, ${tempColour(hi ?? gHi)})` }} />
                {d.isToday && nowT != null && <em style={{ left: `${Math.min(100, Math.max(0, ((nowT - gLo) / span) * 100))}%` }} />}
              </span>
              <span className="lw-day-hi">{hi == null ? '' : `${Math.round(T(hi))}°`}</span>
            </button>
            {on && (
              <div className="lw-day-detail">
                <div className={`lw-parts${dp && np ? '' : ' is-one'}`}>
                  {dp && <PartPanel p={dp} isDay T={T} U={U} />}
                  {np && <PartPanel p={np} isDay={false} T={T} U={U} />}
                </div>
                <div className="lw-day-facts">
                  {ws.map((w) => {
                    const Icon = warningIcon(w.type);
                    return (
                      <button key={w.id} type="button" className="lw-day-fact is-warn" onClick={() => onWarning(w.id)}
                        style={{ background: severityFill(w.severity), color: severityInk(w.severity) }}>
                        <Icon size={13} strokeWidth={2.4} />{`${w.severity} ${String(w.type).toLowerCase()} warning · ${warningHours(w, d.day)}`}
                      </button>
                    );
                  })}
                  {frostLv && (
                    <span className="lw-day-fact" style={{ boxShadow: `inset 0 0 0 1.5px ${frostLv.colour}` }} title="MWUK FROST, MyWeatherUK's snow model">
                      <Snowflake size={13} />{frostLv.name} snow risk · {cmText(d.frost.cm)} · MWUK FROST
                    </span>
                  )}
                  {d.sun.rise && <span className="lw-day-fact"><Sunrise size={13} />{hhmm(d.sun.rise)}</span>}
                  {d.sun.set && <span className="lw-day-fact"><Sunset size={13} />{hhmm(d.sun.set)}</span>}
                  <span className="lw-day-fact"><Moon size={13} />{d.moon.name}</span>
                  <span className="lw-day-fact is-src">{d.models.map(sourceName).join(' + ')}{d.partial ? ' · part of the day' : ''}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <p className="lw-outlook-note">
        Tap a day for its day and night. Days {sources.includes('mo_global') ? 'to the fifth or so ' : ''}from the <b>MWUK Mix</b>, MyWeatherUK&rsquo;s
        blend of the Met Office UKV and DWD ICON-EU{sources.includes('mo_global') ? <>, then the <b>Met Office Global</b></> : ''}.
        Snow from <b>MWUK FROST</b>, thunderstorms from <b>TCM NOVA</b>.
      </p>
    </div>
  );
}

/* the UKV's own days: shown only while the outlook (the Mix and the Global) is not there */
function DaysCard({ model, T, dayIdx, onDay: pick, warnings, onWarning }) {
  const U = useUnits();
  const ds = model.days.filter((d) => d.hi != null);
  const gLo = Math.min(...ds.map((d) => d.lo)), gHi = Math.max(...ds.map((d) => d.hi));
  const span = Math.max(1, gHi - gLo);
  const nowT = model.now.t2;
  return (
    <div className="lw-glass lw-card">
      <div className="lw-title"><CalendarDays />{`${ds.length}-day forecast`}<span className="lw-title-aside">Met Office UKV</span></div>
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
                <p className="lw-day-text">{dayText(d, U)}</p>
                <div className="lw-day-facts">
                  {ws.map((w) => {
                    const Icon = warningIcon(w.type);
                    return (
                      <button key={w.id} type="button" className="lw-day-fact is-warn" onClick={() => onWarning(w.id)}
                        style={{ background: severityFill(w.severity), color: severityInk(w.severity) }}>
                        <Icon size={13} strokeWidth={2.4} />{`${w.severity} ${String(w.type).toLowerCase()} warning · ${warningHours(w, d.day)}`}
                      </button>
                    );
                  })}
                  {d.pRain != null && d.pRain >= 20 && <span className="lw-day-fact"><Umbrella size={13} />{d.pRain}% chance of rain</span>}
                  {thunderRisk(d.thunderPeak?.p) && (
                    <span className="lw-day-fact" title="TCM NOVA, MyWeatherUK's thunderstorm model" style={{ boxShadow: `inset 0 0 0 1.5px ${thunderRisk(d.thunderPeak.p).colour}` }}>
                      <Zap size={13} />{thunderRisk(d.thunderPeak.p).word} thunderstorm risk · {Math.round(d.thunderPeak.p)}% around {hhmm(d.thunderPeak.t)} · TCM NOVA
                    </span>
                  )}
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
function BarMenu({ link, isAdmin, previewOn, onPreview }) {
  const { isF, updateUnit } = useUnits();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  /* add to your home screen (src/lib/location/app.js): the browser's own offer where it has one, else
     (Safari) the two taps that do it */
  const inst = useInstall();
  const [howTo, setHowTo] = useState(false);
  useEffect(() => { if (!open) setHowTo(false); }, [open]);
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
              <button type="button" aria-pressed={!isF} onClick={() => updateUnit('temperature', 'celsius')}>°C</button>
              <button type="button" aria-pressed={isF} onClick={() => updateUnit('temperature', 'fahrenheit')}>°F</button>
            </div>
          </div>
          {link && (
            <button type="button" role="menuitem" className="lw-menu-row" onClick={copy}>
              {copied ? <Check size={16} /> : <Link2 size={16} />}{copied ? 'Link copied' : 'Copy a link to this place'}
            </button>
          )}
          {!inst.standalone && (inst.canPrompt || inst.ios) && (
            <button type="button" role="menuitem" className="lw-menu-row"
              onClick={async () => { if (inst.canPrompt) { setOpen(false); await inst.install(); } else setHowTo((v) => !v); }}>
              <Smartphone size={16} />Add to your home screen
            </button>
          )}
          {howTo && (
            <p className="lw-menu-howto">
              Tap your browser&rsquo;s <b>Share</b> button <Share size={13} aria-hidden="true" />, then <b>Add to Home Screen</b>. It opens
              straight to your Home place, and shows the last forecast when there is no connection.
            </p>
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

/* The cards that do not change with time travel keep their last drawing while the ruler moves (their
   props are the model and steady callbacks); the hero, the sky and the tiles follow it. */
const HourlyMemo = React.memo(HourlyCard);
const PrecipMemo = React.memo(PrecipCard);
const OutlookMemo = React.memo(OutlookCard);
const DaysMemo = React.memo(DaysCard);
const ChartsMemo = React.memo(LocationCharts);
const RadarMemo = React.memo(LocationRadar);
const SnowMemo = React.memo(LocationSnow);
const ThunderMemo = React.memo(LocationThunder);
const StormMemo = React.memo(StormWatch);
const SituationsMemo = React.memo(SituationCards);
const TodayMemo = React.memo(TodayCard);
const CommuteMemo = React.memo(CommuteCard);
const TilesMemo = React.memo(LocationTiles);
const PlacesMemo = React.memo(PlacesStrip);
const AlertsMemo = React.memo(AlertsCard);
const CoastMemo = React.memo(CoastCard);
const TrendMemo = React.memo(TrendCard);

/* the installed app opens with ?app=1 (public/location.webmanifest): straight to your Home place, else
   your first place, else the place last opened on this device */
function appStartPlace(search) {
  const q = new URLSearchParams(search);
  if (q.get('app') !== '1' || q.has('lat') || q.has('location')) return null;
  const d = localPlaces();
  return placeWith(d, 'home') || d.places[0] || lastOpenedPlace();
}
/* "at 14:20 (3 h ago)", for the forecast shown without a connection */
function savedWhen(at) {
  if (!at) return 'earlier';
  const mins = Math.max(0, Math.round((Date.now() - at) / 60e3));
  const ago = mins < 60 ? `${mins} min ago` : mins < 48 * 60 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
  return `at ${hhmm(at)}${ukDay(at) !== ukDay(Date.now()) ? ` on ${dayLabel(ukDay(at))}` : ''} (${ago})`;
}

export default function LocationForecast() {
  const routerLocation = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  /* a link naming a place starts loading at once, rather than flashing the search page first */
  const [loading, setLoading] = useState(() => {
    const q = new URLSearchParams(routerLocation.search);
    /* …and with no place named, the home page is finding you (below), so it waits rather than showing the search */
    return q.has('location') || q.has('lat') || !!appStartPlace(routerLocation.search) || (typeof navigator !== 'undefined' && !!navigator.geolocation);
  });
  const [error, setError] = useState(null);
  const [resp, setResp] = useState(null);
  const [place, setPlace] = useState(null);
  const [outside, setOutside] = useState(null);
  const [dayIdx, setDayIdx] = useState(0);
  /* the day opened in the days card (its Day and Night): today's at first */
  const [openDay, setOpenDay] = useState(() => ukDay(Date.now()));
  /* showing what was last fetched for the place while the fresh forecast loads */
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const U = useUnits();
  const { temp } = U;
  /* the hour sheet: the hour open in it (its time), or null */
  const [sheetT, setSheetT] = useState(null);
  /* your places (src/lib/location/places.js): kept places, Home and Work, the commute; and Compare */
  const [placesData, setPlacesData] = useState(() => localPlaces());
  const [comparing, setComparing] = useState(false);
  const openCompare = useCallback(() => setComparing(true), []);
  /* the best-time finder's activity (HourlyCard), kept on this device */
  const [bestFor, setBestFor] = useState(() => { try { return localStorage.getItem('lw-best-for') || null; } catch { return null; } });
  useEffect(() => { try { if (bestFor) localStorage.setItem('lw-best-for', bestFor); else localStorage.removeItem('lw-best-for'); } catch { /* storage blocked */ } }, [bestFor]);
  /* time travel (TimeTravel.jsx): the hour the page shows, null for now; story mode; the share sheet;
     and the forecast shown without a connection ({ at: when it was saved }) */
  const [travelT, setTravelT] = useState(null);
  const [story, setStory] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [offline, setOffline] = useState(null);
  const closeStory = useCallback(() => { setStory(false); setTravelT(null); }, []);
  const shareFromStory = useCallback(() => { setStory(false); setTravelT(null); setSharing(true); }, []);
  const closeShare = useCallback(() => setSharing(false), []);
  /* this page's own app manifest and its offline worker (src/lib/location/app.js) */
  useLocationApp();
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
  /* a place has been chosen (searched, opened, linked): the home page's own locate then stays out of the way */
  const chosenRef = useRef(false);
  const stripRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await currentUser();
      if (cancelled) return;
      setUser(me); userRef.current = me; setAuthChecked(true);
      loadPlaces(me).then((d) => { if (!cancelled) setPlacesData(d); });
      if (me) { const list = await loadRecent(me); if (!cancelled) setRecent(list); }
    })();
    return () => { cancelled = true; };
  }, []);

  /* one search at a time: a newer one aborts the older */
  /* auto: the home page's own locate (below): a place outside the UK leaves the search, no dialog */
  const run = useCallback(async (p, { quiet = false, auto = false } = {}) => {
    const name = (p?.name || '').trim();
    const hasCoords = Number.isFinite(p?.lat) && Number.isFinite(p?.lon);
    if (!name && !hasCoords) return;
    if (!auto) chosenRef.current = true;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    if (!quiet) { setLoading(true); setError(null); setOutside(null); setGeoError(''); setSheetT(null); }
    /* a place opened in the last 20 minutes shows at once from what was fetched then, and is brought up
       to date in place (ukvLocation.js cachedLocation) */
    const cached = !quiet && cachedLocation({ lat: p.lat, lon: p.lon, name });
    if (cached?.location) {
      setResp(cached);
      setPlace({ name: cached.location.name, lat: cached.location.lat, lon: cached.location.lon, region: p.region || '' });
      setDayIdx(0); setOpenDay(ukDay(Date.now())); setLoading(false); setRefreshing(true);
    }
    try {
      const body = await fetchLocation({ lat: p.lat, lon: p.lon, name }, ac.signal);
      if (ac.signal.aborted) return;
      if (body.code === 'OUTSIDE_UK') { if (!quiet && !auto) setOutside({ query: name || body.resolvedName, country: body.resolvedCountry }); return; }
      setResp(body);
      setOffline(null);
      setPlace({ name: body.location.name, lat: body.location.lat, lon: body.location.lon, region: p.region || '' });
      if (!quiet) {
        if (!cached) { setDayIdx(0); setOpenDay(ukDay(Date.now())); }
        rememberSearch(userRef.current, { name: body.location.name, region: p.region || '', lat: body.location.lat, lon: body.location.lon })
          .then((list) => { if (list) setRecent(list); });
      }
    } catch (e) {
      if (e?.name === 'AbortError') return;
      /* no connection (the installed app opened offline, or the network dropped): the forecast saved for
         the place last time, at any age, labelled with when it was saved */
      if (!navigator.onLine || e?.name === 'TypeError') {
        const old = cachedLocationAny({ lat: p.lat, lon: p.lon, name });
        if (old) {
          if (!quiet) {
            setResp(old.body);
            setPlace({ name: old.body.location.name, lat: old.body.location.lat, lon: old.body.location.lon, region: p.region || '' });
          }
          setOffline({ at: old.at });
          return;
        }
      }
      if (!quiet) setError(e?.message || 'Could not load the forecast. Please try again shortly.');
    } finally {
      if (!quiet && !ac.signal.aborted) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  /* keep it current: re-read every five minutes, and re-derive "now" (and the next hour) every minute */
  useEffect(() => {
    if (!place) return undefined;
    const a = setInterval(() => run(place, { quiet: true }), REFRESH_MS);
    const b = setInterval(() => setTick((x) => x + 1), 60e3);
    return () => { clearInterval(a); clearInterval(b); };
  }, [place, run]);

  /* the installed app's first screen: your place, at once (from the forecast saved for it if offline) */
  const appStart = useRef(undefined);
  if (appStart.current === undefined) appStart.current = appStartPlace(routerLocation.search);
  useEffect(() => {
    const p = appStart.current;
    if (!p) return;
    appStart.current = null;
    setQuery(p.name);
    run({ lat: p.lat, lon: p.lon, name: p.name, region: p.region });
  }, [run]);
  /* the connection back: fetched afresh */
  useEffect(() => {
    if (!offline || !place) return undefined;
    const back = () => run(place, { quiet: true });
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, [offline, place, run]);

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) { setGeoError('This browser cannot share a location.'); return; }
    setLocating(true); setGeoError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(false); run({ lat: pos.coords.latitude, lon: pos.coords.longitude }); },
      () => { setLocating(false); setGeoError('Location unavailable: permission was declined or the request timed out.'); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }, [run]);

  /* The app's home page (17 Nov 2026, the iOS-app redesign: "it shows the person's current location or they can
     search up a location if they did not allow location"): opened with no place named, it finds where you are, as
     the iPhone's Weather app does. A link naming a place, or the installed app's start place, still comes first;
     after a no to sharing the location, the search shows, as before. */
  /* Quieter than "Use my location": if it fails the search simply shows (no error under it), a place it finds
     outside the UK leaves the search rather than opening that dialog, and a place chosen while it was looking wins. */
  const autoLocate = useCallback(() => {
    /* a location question left unanswered: the search shows after 12 s (the answer, if it comes, still opens it) */
    const wait = setTimeout(() => { if (!chosenRef.current) setLoading(false); }, 12000);
    const done = () => { clearTimeout(wait); setLocating(false); if (!chosenRef.current) setLoading(false); };
    if (!navigator.geolocation) { done(); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(wait);
        setLocating(false);
        if (chosenRef.current) return;
        run({ lat: pos.coords.latitude, lon: pos.coords.longitude }, { auto: true });
      },
      done,
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }, [run]);
  const autoLocated = useRef(false);
  useEffect(() => {
    if (autoLocated.current) return;
    const q = new URLSearchParams(routerLocation.search);
    if (q.has('lat') || q.has('location') || appStartPlace(routerLocation.search)) return;
    autoLocated.current = true;
    const perms = typeof navigator !== 'undefined' ? navigator.permissions : null;
    if (!perms?.query) { autoLocate(); return; }
    perms.query({ name: 'geolocation' }).then(
      (st) => { if (st.state !== 'denied') autoLocate(); else if (!chosenRef.current) setLoading(false); },
      () => autoLocate());
  }, [routerLocation.search, autoLocate]);

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
  const T = temp;
  const deg = (c) => (c == null ? '—' : `${Math.round(T(c))}°`);
  /* floods, health alerts, air quality, the tide and the normals for the place (OutsideCards.jsx, Phase E) */
  const feeds = useOutside(lat, lon);
  /* the page at the hour travelled to (the hero, the tiles and the sky read it); the model itself at now;
     a new place starts at now, and an hour gone from the forecast goes back to now */
  const travel = useMemo(() => (model && travelT != null ? travelModel(model, travelT) : model), [model, travelT]);
  /* The sky's extras at the hour shown (Phase G, SkyBackdrop.jsx): a rainbow when the sun is low and
     out with showers within an hour and a half; the aurora on a clear dark night when NOAA's Kp for that
     time reaches what this latitude needs (situations.js auroraKp); shooting stars on a clear dark night,
     many near a meteor shower's peak and the odd one otherwise. And on the cards: fog drifting over them
     in fog, and their glass misting in saturated air. */
  const [kpList, setKpList] = useState(null);
  useEffect(() => { fetchKp().then(setKpList).catch(() => {}); }, []);
  const skyExtras = useMemo(() => {
    const none = { rainbow: 0, aurora: 0, meteors: 0, mist: 0, fog: 0 };
    if (!model || !travel?.now) return none;
    const n = travel.now, t = travel.at ?? Date.now();
    const cover = n.tcc ?? 100;
    const out = { ...none };
    if (n.isDay && n.sun > 3 && n.sun < 42 && cover < 85 && !['heavyRain', 'torrentialRain', 'thunder', 'fog', 'mist', 'overcast', 'cloudy'].includes(n.cond)) {
      const wet = model.full.some((h) => Math.abs(h.t - t) <= 90 * 60e3 && rateOf(h) >= 0.2) || (travelT == null && (model.now.precipRate ?? 0) >= 0.1);
      if (wet) out.rainbow = Math.min(1, 0.55 + (85 - cover) / 120);
    }
    const dark = !n.isDay && n.sun < -12;
    if (dark && cover < 60 && kpList?.length) {
      const k = kpList.filter((x) => x.t <= t).pop() || kpList[0];
      const need = auroraKp(model.lat);
      if (k) out.aurora = Math.max(0, Math.min(1, (k.kp - need + 1) / 2.5)) * (1 - cover / 70);
    }
    if (dark && cover < 50) {
      const d = new Date(t);
      const md = (m, day) => Date.UTC(2001, m - 1, day);
      const today = md(d.getMonth() + 1, d.getDate());
      const shower = SHOWERS.find((x) => Math.abs(md(x.m, x.d) - today) <= 1.5 * 864e5);
      out.meteors = shower ? Math.min(1, 0.25 + shower.zhr / 160) : 0.06;
    }
    const fogNow = n.cond === 'fog' || (n.vis != null && n.vis < 1);
    if (fogNow) out.fog = n.vis != null && n.vis < 0.2 ? 1 : 0.6;
    const spread = n.t2 != null && n.td != null ? n.t2 - n.td : null;
    if (!fogNow && (n.rh ?? 0) >= 95 && (n.t2 ?? 0) > 0.5 && !isWet(n.cond) && (spread == null || spread <= 1.2)) out.mist = Math.min(1, 0.4 + ((n.rh ?? 95) - 95) / 8);
    return out;
  }, [model, travel, travelT, kpList]);
  useEffect(() => { setTravelT(null); }, [lat, lon]);
  useEffect(() => {
    if (travelT != null && model && !travelSteps(model).some((x) => x.t === travelT)) setTravelT(null);
  }, [model, travelT]);

  /* ── the hour sheet, links to a moment, and cards to go to ── */
  const placeLink = useCallback((extra = '') => (model
    ? `${window.location.origin}/LocationWeather?lat=${model.lat.toFixed(4)}&lon=${model.lon.toFixed(4)}&name=${encodeURIComponent(model.location.name)}${extra}`
    : null), [model]);
  const linkFor = useCallback((t) => placeLink(`&at=${momentParam(t)}`), [placeLink]);
  /* a card by name (…&card=radar, or a Today chip): scrolled to just under the search bar; a card with
     nothing to show today has no room, so the chip goes to the tiles instead */
  const goCard = useCallback((name) => {
    const find = (n) => { const el = document.getElementById(`lw-card-${n}`); return el && el.offsetParent !== null && el.childElementCount ? el : null; };
    /* 'settle|snow': the first of them on the page */
    const el = [...String(name).split('|'), 'tiles'].map(find).find(Boolean);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const scrollStripTo = useCallback((t) => {
    const el = stripRef.current?.querySelector(`[data-t="${t}"]`);
    if (el) stripRef.current.scrollTo({ left: Math.max(0, el.offsetLeft - 8), behavior: 'smooth' });
  }, []);
  /* a link to a moment (…&at=2026-11-21T15:00) opens that hour's sheet, and …&card=radar goes to a
     card: once for each link, not again every time the forecast refreshes */
  const linkDone = useRef('');
  useEffect(() => {
    if (!model) return;
    const key = routerLocation.search;
    if (linkDone.current === key) return;
    linkDone.current = key;
    const q = new URLSearchParams(key);
    const at = parseMoment(q.get('at'));
    const h = at != null ? hourFor(model, at) : null;
    if (h) { setSheetT(h.t); setTimeout(() => scrollStripTo(h.t), 250); }
    if (q.get('card')) setTimeout(() => goCard(q.get('card')), 400);
  }, [model, routerLocation.search, goCard, scrollStripTo]);
  /* while an hour is open, the address bar is a link to it (shared as it is); closing takes the hour off */
  useEffect(() => {
    if (!model) return;
    const url = new URL(window.location.href);
    if (sheetT != null) {
      url.searchParams.set('lat', model.lat.toFixed(4));
      url.searchParams.set('lon', model.lon.toFixed(4));
      url.searchParams.set('name', model.location.name);
      url.searchParams.delete('location');
      url.searchParams.set('at', momentParam(sheetT));
    } else url.searchParams.delete('at');
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url.href);
  }, [sheetT, model]);
  /* your places: shown at once, kept in this browser and the account */
  const changePlaces = useCallback((d) => {
    setPlacesData(d);
    savePlaces(userRef.current, d).then(setPlacesData);
  }, []);
  const openPlace = useCallback((p) => { setQuery(p.name); run({ lat: p.lat, lon: p.lon, name: p.name, region: p.region }); window.scrollTo({ top: 0, behavior: 'smooth' }); }, [run]);
  const home = placeWith(placesData, 'home'), work = placeWith(placesData, 'work');
  const atCommutePlace = !!place && (samePlace(place, home) || samePlace(place, work));

  /* the cards that matter most today (the Today card's chips) come up the page on a phone */
  /* (not the tiles or the days: those are the general cards, and a cold-feel or frost chip pointing
     at the tiles would lift fourteen of them up the page) */
  const lifted = useMemo(() => new Set(model ? mattersToday(model, warnings, U, feeds).flatMap((m) => m.card.split('|')).filter((n) => n !== 'tiles' && n !== 'days') : []), [model, warnings, U, feeds]);
  /* a slot comes up when its card, or one of the cards it holds, matters today */
  const slot = (name, holds = [name]) => `lw-slot lw-o-${name}${holds.some((n) => lifted.has(n)) ? ' is-lifted' : ''}`;

  /* back from a forecast goes to the search; from the search, to the previous page */
  const backOut = () => {
    if (!model) { navigate(-1); return; }
    abortRef.current?.abort();
    setResp(null); setPlace(null); setQuery(''); setError(null);
  };

  /* a day picked on the charts (by its place in the UKV's days) or in the days card (by its date):
     both follow, and the hourly strip scrolls to it where it reaches */
  const showDay = useCallback((day) => {
    const el = day && stripRef.current?.querySelector(`[data-day="${day}"]`);
    if (el && stripRef.current) stripRef.current.scrollTo({ left: el.offsetLeft - 8, behavior: 'smooth' });
  }, []);
  const pickDay = useCallback((i) => {
    setDayIdx(i);
    const d = model?.days[i];
    if (d) { setOpenDay(d.day); showDay(d.day); }
  }, [model, showDay]);
  const openOutlookDay = useCallback((day) => {
    setOpenDay(day);
    const i = day ? model?.days.findIndex((d) => d.day === day) : -1;
    if (i >= 0) { setDayIdx(i); showDay(day); }
  }, [model, showDay]);

  /* the sky: the weather now at the place, or a mild default before a search */
  const sky = useMemo(() => {
    if (preview) { const p = previewSky(preview); return { ...p, snow: ['snow', 'heavySnow', 'snowShowers', 'blizzard'].includes(p.cond) ? Math.max(0.3, p.rate) : ['sleet', 'mix'].includes(p.cond) ? p.rate * 0.5 : 0 }; }
    if (model) {
      const n = travel.now;
      const rate = n.span > 0 ? (n.precip ?? 0) / n.span : n.precipRate ?? 0;
      /* the snow falling now (mm/h of water): the radar's rate times what of it is snow */
      const snow = n.span > 0 && n.snow != null ? n.snow / n.span : n.snowRate ?? 0;
      return { cond: n.cond, sun: n.sun, morning: hourOf(travel.at ?? Date.now()) < 12, wind: n.wind ?? 8, wdir: n.wdir ?? 240, rate, snow, cloud: n.tcc ?? 60, rainbow: skyExtras.rainbow, aurora: skyExtras.aurora, meteors: skyExtras.meteors };
    }
    const sun = sunElevation(Date.now(), 52.5, -1.5);
    return { cond: 'partly', sun, morning: hourOf(Date.now()) < 12, wind: 10, wdir: 240, rate: 0, cloud: 45 };
  }, [model, travel, preview, skyExtras]);
  const togglePreview = () => {
    setHidePage(false);
    setPreview((p) => (p ? null : { ...PREVIEW_START, cond: model?.now.cond || PREVIEW_START.cond }));
  };
  const dark = skyDarkness(sky.cond, sky.sun);
  /* today's high and low: the days card's (the Mix and today's observed), else the UKV's */
  const olToday = model?.outlook?.days?.find((d) => d.isToday);
  const today = olToday ? { hi: olToday.hi, lo: olToday.lo } : model?.days[0];
  const heroRange = travelT != null && model ? dayRange(model, travelT) : today;
  /* the day against yesterday (today only, from yesterday's observed high when most of the day was
     analysed) and against the district's 1991-2020 normal for the date */
  const vsLine = model ? compareWords({
    hi: heroRange?.hi ?? null,
    yesterdayHi: travelT == null && (model.yesterday?.analyses ?? 0) >= 64 ? model.yesterday.t2_max ?? null : null,
    normal: feeds?.normal, day: travelT ?? Date.now(), U,
  }) : null;
  /* story mode shows the sky alone behind its cards */
  const pageHidden = hidePage || story;
  const runs = model?.runs || [];
  const olRuns = model?.outlook?.runs || [];

  return (
    <div className="lw-page" data-sky={dark < 0.3 ? 'bright' : dark < 0.55 ? 'mid' : 'dark'}>
      <SkyBackdrop {...sky} />
      {model && !pageHidden && <CardRain cond={sky.cond} rate={sky.rate} wind={sky.wind} wdir={sky.wdir} />}
      {model && !pageHidden && <CardSnow cond={sky.cond} rate={sky.snow} wind={sky.wind} wdir={sky.wdir} />}
      {/* frost on the glass below freezing: the temperature now (the sky preview's snowy skies at -3 C) */}
      {model && !pageHidden && <CardFrost temp={preview ? (preview.extras?.ferns ? -8 : sky.snow > 0 ? -3 : null) : travel.now.t2} />}
      {model && !pageHidden && <WindowRain cond={sky.cond} rate={sky.rate} wind={sky.wind} wdir={sky.wdir} />}
      {/* misted glass in saturated air, and fog drifting over the cards in fog (Phase G) */}
      {model && !pageHidden && <CardMist amount={preview ? (preview.extras?.mist ? 0.85 : 0) : skyExtras.mist} />}
      {model && !pageHidden && <CardFog amount={preview ? (preview.extras?.fog ? 0.9 : 0) : skyExtras.fog} wdir={sky.wdir} />}

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

      {comparing && <CompareSheet data={placesData} current={place} onClose={() => setComparing(false)} />}

      {/* the forecast card by card over the live sky (StoryMode.jsx), and as a picture (ShareSheet.jsx) */}
      {model && story && <StoryMode model={model} onSky={setTravelT} onClose={closeStory} onShare={shareFromStory} />}
      {model && sharing && <ShareSheet model={model} warnings={warnings} onClose={closeShare} />}

      {/* everything for one hour (HourSheet.jsx): from the hourly strip, or a link to the moment */}
      {model && sheetT != null && !hidePage && (
        <HourSheet model={model} t={sheetT} linkFor={linkFor}
          onClose={() => setSheetT(null)} onMove={(t) => { setSheetT(t); scrollStripTo(t); }} />
      )}

      {/* one glass bar: back, the search, my location, and a menu for the rest */}
      <div className="lw-head" style={pageHidden ? { visibility: 'hidden' } : undefined}>
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
          <BarMenu isAdmin={isAdmin} previewOn={!!preview} onPreview={togglePreview}
            link={model ? `${window.location.origin}/LocationWeather?lat=${model.lat.toFixed(4)}&lon=${model.lon.toFixed(4)}&name=${encodeURIComponent(model.location.name)}` : null} />
        </div>
      </div>

      <div className="lw-wrap" style={pageHidden ? { display: 'none' } : undefined}>
        {error && <div className="lw-error" role="alert">{error}</div>}
        {geoError && model && <div className="lw-error" role="alert">{geoError}</div>}

        {/* your places, one tap away (YourPlaces.jsx); on the search page your commute too */}
        <PlacesMemo data={placesData} current={place} onOpen={openPlace} onChange={changePlaces} onCompare={openCompare} />
        {!model && !loading && <CommuteCard data={placesData} onChange={changePlaces} />}

        {loading && !model && (
          <div className="lw-loading"><div className="lw-spinner" /><span>{locating ? 'Finding where you are…' : 'Reading the forecast…'}</span></div>
        )}

        {!model && !loading && (
          <LocationLanding
            query={query} onQueryChange={setQuery}
            onSearch={(p) => { if (p?.name) setQuery(p.name); run(p); }}
            loading={loading} recent={recent}
            onForget={async (r) => { const list = await forgetSearch(user, r); if (list) setRecent(list); }}
            onClearAll={async () => { const list = await clearRecent(user); if (list) setRecent(list); }}
            user={user} authChecked={authChecked}
            onUseMyLocation={useMyLocation} locating={locating} geoError={geoError}
          />
        )}

        {model && (
          <>
            {/* the hero: now, or the hour travelled to (TimeTravel.jsx) */}
            <header className="lw-hero" aria-live={travelT == null ? 'polite' : 'off'}>
              <div className="lw-hero-name"><span translate="no">{model.location.name}</span><SaveStar place={place} data={placesData} onChange={changePlaces} /></div>
              <div className="lw-hero-temp">{deg(travel.now.t2)}</div>
              <div className="lw-hero-cond">{condLabel(travel.now.cond, travel.now.isDay, travel.now.windy)}</div>
              {heroRange && <div className="lw-hero-hl">H:{deg(heroRange.hi)}&nbsp;&nbsp;L:{deg(heroRange.lo)}</div>}
              {vsLine && <div className="lw-hero-vs" title={feeds?.normal ? `Normal: the Met Office ${feeds.normal.period} average for ${feeds.normal.name}` : undefined}>{vsLine}</div>}
              <div className="lw-hero-meta">
                Feels like {deg(travel.now.feels)}
                {travelT != null ? ` · the forecast for ${travelLabel(travelT)}` : model.analysis?.valid ? ` · observed analysis ${hhmm(Date.parse(model.analysis.valid))}` : ''}
                {refreshing ? <span className="lw-updating"><Loader2 size={11} className="animate-spin" />updating</span> : null}
              </div>
              <div className="lw-hero-acts">
                <button type="button" className="lw-chip" onClick={() => setStory(true)}><Play size={14} />Play the forecast</button>
                <button type="button" className="lw-chip" onClick={() => setSharing(true)}><Share2 size={14} />Share</button>
              </div>
            </header>
            {offline && (
              <div className="lw-offline" role="status"><WifiOff size={15} />No connection. This is the forecast saved {savedWhen(offline.at)}.</div>
            )}
            {/* slide to any hour: the sky, the hero and the tiles follow */}
            <TimeTravel model={model} value={travelT} onChange={setTravelT} onSettle={scrollStripTo} />

            {warnings.length > 0 && (
              /* lw-warn-card: the top card while there is a warning, the one the rain and snow land on */
              <div id="lw-card-warnings" className="lw-glass lw-card lw-warn-card" style={{ marginBottom: 14 }}>
                <div className="lw-title"><AlertTriangle />Weather warnings<span className="lw-title-aside">{warnings.length === 1 ? '1 for this place' : `${warnings.length} for this place`}</span></div>
                <LocationWarnings warnings={warnings} openId={openWarn} onToggle={setOpenWarn} />
              </div>
            )}

            {/* the forecast in words, and what matters most today (TodayCard.jsx) */}
            {/* flood warnings nearby and UKHSA's health alerts, while one is in force */}
            <AlertsMemo outside={feeds} />
            <TodayMemo model={model} warnings={warnings} onCard={goCard} outside={feeds} />

            {/* The layout (15 Nov 2026, the user's: the radar to the right of the days, the detailed
                forecast moved up). On a computer: the hours, the precipitation, the detailed forecast and
                the thunderstorm risk beside the tiles; then the days with the radar to their right; then
                the snow. On a phone one column, in the order of the lw-o-* classes (location.css). A
                card that has nothing to show leaves its slot empty, and an empty slot takes no room. */}
            <div className="lw-layout">
              <div className="lw-col">
                <div id="lw-card-hourly" className={slot('hourly')}>
                  <HourlyMemo model={model} T={T} stripRef={stripRef} warnings={warnings} onWarning={showWarning} onHour={setSheetT} sheetT={sheetT} bestFor={bestFor} onBestFor={setBestFor} />
                </div>
                <div id="lw-card-precip" className={slot('precip')}><PrecipMemo model={model} /></div>
                <div id="lw-card-indices" className={slot('indices')} style={{ order: 2 }}><EverydayIndices model={model} /></div>
                {/* road ice and fog, snow settling, the night sky, event days: each only when it has
                    something to say (SituationCards.jsx) */}
                <div id="lw-card-situations" className={`${slot('situations', ['roads', 'settle', 'nightsky', 'events', 'coast'])} lw-situations`}>
                  {atCommutePlace && <CommuteMemo data={placesData} onChange={changePlaces} />}
                  <SituationsMemo model={model} />
                  <CoastMemo outside={feeds} />
                </div>
                <div id="lw-card-detail" className={slot('detail')}><ChartsMemo model={model} dayIdx={dayIdx} onDay={pickDay} /></div>
                {/* lightning near here, heavy rain on its way, the AI lightning warning, the storm type and
                    hail: only when there is something to watch (StormWatch.jsx) */}
                <div id="lw-card-storm" className={slot('storm', ['storm', 'thunder'])}><StormMemo model={model} /></div>
                <div id="lw-card-thunder" className={slot('thunder')}><ThunderMemo model={model} /></div>
              </div>
              <div className="lw-col">
                <div id="lw-card-tiles" className={slot('tiles')}><TilesMemo model={travel} outside={feeds} /></div>
              </div>
              <div id="lw-card-days" className={slot('days')}>
                {model.outlook?.days?.length
                  ? <OutlookMemo model={model} T={T} selected={openDay} onDay={openOutlookDay} warnings={warnings} onWarning={showWarning} />
                  : <DaysMemo model={model} T={T} dayIdx={dayIdx} onDay={pickDay} warnings={warnings} onWarning={showWarning} />}
                {/* the days beyond them, as the GEFS ensemble average leans (TrendCard.jsx, Phase G) */}
                <TrendMemo lat={model.lat} lon={model.lon} normal={feeds?.normal || null}
                  fromDay={model.outlook?.days?.[model.outlook.days.length - 1]?.day || model.days[model.days.length - 1]?.day || null} />
              </div>
              <div id="lw-card-radar" className={slot('radar')}>
                <div className="lw-glass lw-card">
                  <div className="lw-title"><Radar />Rain radar<span className="lw-title-aside">Met Office 1 km · then UKV</span></div>
                  <RadarMemo lat={model.lat} lon={model.lon} />
                </div>
              </div>
              <div id="lw-card-snow" className={slot('snow')}><SnowMemo model={model} /></div>
            </div>

            <p className="lw-source">
              Forecast: Met Office UKV 2 km model from the Met Office&rsquo;s open data on AWS
              {runs.length ? ` — ${runs.map((r) => `${runName(r.run)} run to T+${r.top}`).join(', then ')}` : ''}.
              {model.cell ? ` The nearest model grid point is ${model.cell.offset_km} km away.` : ''}
              <br />Now: the UKV analysed every 15 minutes with station reports, cloud from Meteosat and the airports, and the radar&rsquo;s rain. Radar: Met Office 1 km composite.
              The next hour: the newest radar scan carried forward by the way the rain has moved over the last half hour.
              {model.anchor ? ' The first hours are held to what is observed now, fading back to the model over the following hours.' : ''}
              {' '}Cloud is the sky within 8 km. Chance of rain counts model rain within 10 km.
              {' '}Every 15 minutes: the radar carried forward for the next hour and a half, then the UKV&rsquo;s hours, its rain shared out by its rates.
              {olRuns.length ? <><br />The days: {olRuns.map((r) => `${sourceName(r.model)}${r.pair ? ` (UKV ${runName(r.pair.ukv)} + ICON-EU ${runName(r.pair.icon)})` : ` ${runName(r.run)}`}`).join(', then ')}. The MWUK Mix is MyWeatherUK&rsquo;s blend of the two models, the UKV counting a little more over the first two days.</> : ''}
              {model.frost ? <><br />Snow: <b>MyWeatherUK&rsquo;s MWUK FROST model</b>. Snow chance each hour: MyWeatherUK&rsquo;s snow conditions index from the UKV.</> : ''}
              {model.nova ? <><br />Thunderstorm risk: <b>MyWeatherUK&rsquo;s own TCM NOVA model</b> (Hyper-Short nowcast, then Main Run), not the Met Office.</> : ''}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
