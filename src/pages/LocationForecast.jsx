/* Location Weather.

   One place's weather from the Met Office UKV 2 km model on AWS (server/locationWeather.js),
   in liquid glass over a live animated sky:
     • the hero: the temperature now, from the 15-minute UKV + station analysis
     • weather warnings whose area covers the place
     • the hourly strip to T+120 (hourly to T+54, then three-hourly, as UKV publishes)
     • rain in the next 12 hours, when there is any
     • the days, with their ranges on one shared scale
     • the Met Office radar for the past three hours and UKV rain for the next hours
     • fourteen detail tiles and ten interactive charts
   The route key stays "LocationWeather" (pages.config.js), so every old link still works;
   ?location=Name opens a place directly. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock3, CalendarDays, Radar, AlertTriangle, CloudRain, Crosshair, ChevronLeft, ChevronRight, Loader2, Palette } from 'lucide-react';
import LocationSearchBox from '@/components/location/LocationSearchBox';
import LocationLanding from '@/components/location/LocationLanding';
import LocationWarnings from '@/components/location/LocationWarnings';
import LocationRadar from '@/components/location/LocationRadar';
import LocationTiles from '@/components/location/LocationTiles';
import LocationCharts, { tempColour } from '@/components/location/LocationCharts';
import SkyBackdrop, { skyDarkness } from '@/components/location/SkyBackdrop';
import SkyPreview, { PREVIEW_START, previewSky } from '@/components/location/SkyPreview';
import { isCurrentUserAdmin } from '@/lib/tcmFetchPolicy';
import WxIcon from '@/components/location/WxIcon';
import '@/components/location/location.css';
import { currentUser, loadRecent, rememberSearch, forgetSearch, clearRecent } from '@/lib/locationHistory';
import { fetchAllWarningsForPoint } from '@/lib/locationWarnings';
import {
  fetchLocation, shape, condLabel, isWet, nextHoursText, dayText, hhmm, hourOf, sunElevation, compass,
} from '@/lib/ukvLocation';

const REFRESH_MS = 10 * 60e3;
const runName = (iso) => {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}Z ${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}`;
};

/* ── the hourly strip ────────────────────────────────────────────────────── */
function HourlyCard({ model, T, stripRef }) {
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
        {items.map((it, k) => {
          const day = new Date(it.t).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Europe/London' });
          const dayStart = it.h && lastDay !== null && it.h.day !== lastDay;
          if (it.h) lastDay = it.h.day;
          if (it.sun) {
            return (
              <div key={`s${it.t}`} className="lw-hour">
                <span className="lw-h-day" />
                <span className="lw-h-time">{hhmm(it.t)}</span>
                <WxIcon cond="clear" day size={30} title={it.sun} />
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
              <WxIcon cond={k === 0 ? model.now.cond : h.cond} day={k === 0 ? model.now.isDay : h.isDay} size={30} title={condLabel(h.cond, h.isDay)} />
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
  );
}

/* ── rain in the next 12 hours (only when there is some) ─────────────────── */
function RainSoonCard({ model }) {
  const hs = model.full.filter((h) => h.t > Date.now() - 30 * 60e3).slice(0, 12);
  const wet = hs.filter((h) => isWet(h.cond));
  if (!wet.length || hs.length < 4) return null;
  const rate = (h) => (h.span > 0 ? (h.precip ?? 0) / h.span : h.precipRate ?? 0);
  const peak = wet.reduce((a, b) => (rate(b) > rate(a) ? b : a));
  const first = wet[0];
  const nowWet = isWet(model.now.cond);
  const heaviest = peak === first || peak === hs[0] ? '' : `, heaviest around ${hhmm(peak.t)}`;
  const head = nowWet
    ? `${condLabel(model.now.cond, true)} now${heaviest}.`
    : `${condLabel(first.cond, first.isDay)} from about ${hhmm(first.t)}${heaviest}.`;
  return (
    <div className="lw-glass lw-card">
      <div className="lw-title"><CloudRain />Rain in the next 12 hours</div>
      <p className="lw-summary" style={{ borderBottom: 0, paddingBottom: 0, marginBottom: 4 }}>{head}</p>
      <div className="lw-rainbars" aria-label="Rain each hour for the next 12 hours">
        {hs.map((h) => {
          const r = rate(h);
          const snowy = (h.snow ?? 0) > (h.precip ?? 0) / 2;
          return <i key={h.t} title={`${hhmm(h.t)}: ${r.toFixed(1)} mm/h`} className={r < 0.05 ? 'is-dry' : snowy ? 'is-snow' : ''} style={{ height: `${Math.max(3, Math.min(100, (Math.sqrt(r) / Math.sqrt(8)) * 100))}%` }} />;
        })}
      </div>
      <div className="lw-rainaxis"><span>Now</span><span>{hhmm(hs[Math.floor(hs.length / 2)].t)}</span><span>{hhmm(hs[hs.length - 1].t)}</span></div>
    </div>
  );
}

/* ── the days ─────────────────────────────────────────────────────────────── */
function DaysCard({ model, T, dayIdx, onDay }) {
  const ds = model.days.filter((d) => d.hi != null);
  const gLo = Math.min(...ds.map((d) => d.lo)), gHi = Math.max(...ds.map((d) => d.hi));
  const span = Math.max(1, gHi - gLo);
  const nowT = model.now.t2;
  return (
    <div className="lw-glass lw-card">
      <div className="lw-title"><CalendarDays />{ds.length}-day forecast<span className="lw-title-aside">Met Office UKV</span></div>
      {ds.map((d) => {
        const i = model.days.indexOf(d);
        const left = ((d.lo - gLo) / span) * 100, width = Math.max(4, ((d.hi - d.lo) / span) * 100);
        return (
          <React.Fragment key={d.day}>
            <button type="button" className={`lw-day${i === dayIdx ? ' is-on' : ''}`} onClick={() => onDay(i)} aria-pressed={i === dayIdx}>
              <span className="lw-day-name">{d.label}</span>
              <span className="lw-day-icon">
                <WxIcon cond={d.cond} day size={30} title={condLabel(d.cond, true)} />
                {d.pRain != null && d.pRain >= 20 && isWet(d.cond) ? <b>{d.pRain}%</b> : null}
              </span>
              <span className="lw-day-lo">{Math.round(T(d.lo))}°</span>
              <span className="lw-range">
                <i style={{ left: `${left}%`, width: `${width}%`, background: `linear-gradient(90deg, ${tempColour(d.lo)}, ${tempColour(d.hi)})` }} />
                {d.isToday && nowT != null && <em style={{ left: `${Math.min(100, Math.max(0, ((nowT - gLo) / span) * 100))}%` }} />}
              </span>
              <span className="lw-day-hi">{Math.round(T(d.hi))}°</span>
            </button>
            {i === dayIdx && (
              <div className="lw-day-sub">
                {dayText(d)}{d.sun.rise ? ` · sunrise ${hhmm(d.sun.rise)}, sunset ${hhmm(d.sun.set)}` : ''}{d.partial ? ' · part day (end of the UKV run)' : ''}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function LocationForecast() {
  const routerLocation = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  /* a link naming a place starts loading at once, rather than flashing the search page first */
  const [loading, setLoading] = useState(() => new URLSearchParams(routerLocation.search).has('location'));
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

  /* keep it current: re-read every ten minutes, and re-derive "now" every minute */
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

  useEffect(() => {
    const loc = new URLSearchParams(routerLocation.search).get('location');
    if (loc) { setQuery(loc); run({ name: loc }); }
  }, [routerLocation.search, run]);

  const lat = place?.lat, lon = place?.lon;
  useEffect(() => {
    let cancelled = false;
    setWarnings([]);
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

      <div className="lw-head" style={hidePage ? { visibility: 'hidden' } : undefined}>
        <button type="button" className="lw-icon-btn" onClick={backOut} aria-label={model ? 'Back to search' : 'Back'}>
          <ArrowLeft size={16} />
        </button>
        {(model || loading || error) && (
          <>
            <div className="lw-search"><LocationSearchBox value={query} onChange={setQuery} onSearch={(p) => run(p)} loading={loading} /></div>
            <button type="button" className="lw-icon-btn" onClick={useMyLocation} aria-label="Use my location" title="Use my location">
              {locating ? <Loader2 size={15} className="animate-spin" /> : <Crosshair size={15} />}
            </button>
          </>
        )}
        {isAdmin && (
          <button type="button" className="lw-icon-btn" onClick={togglePreview} aria-pressed={!!preview} title="Preview every sky (admin)" aria-label="Preview every sky"
            style={{ marginLeft: 'auto', ...(preview ? { background: 'rgba(255,255,255,0.9)', color: '#0b1a2c' } : null) }}>
            <Palette size={15} />
          </button>
        )}
        <div className="lw-seg" role="group" aria-label="Temperature unit" style={{ marginLeft: isAdmin ? 0 : 'auto' }}>
          <button type="button" aria-pressed={unit === 'C'} onClick={() => setUnit('C')}>°C</button>
          <button type="button" aria-pressed={unit === 'F'} onClick={() => setUnit('F')}>°F</button>
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
              <div className="lw-hero-cond">{condLabel(model.now.cond, model.now.isDay)}</div>
              {today && <div className="lw-hero-hl">H:{deg(today.hi)}&nbsp;&nbsp;L:{deg(today.lo)}</div>}
              <div className="lw-hero-meta">
                Feels like {deg(model.now.feels)}
                {model.analysis?.valid ? ` · observed analysis ${hhmm(Date.parse(model.analysis.valid))}` : ''}
              </div>
            </header>

            {warnings.length > 0 && (
              <div className="lw-glass lw-card" style={{ marginBottom: 14 }}>
                <div className="lw-title"><AlertTriangle />Weather warnings</div>
                <LocationWarnings warnings={warnings} />
              </div>
            )}

            <div className="lw-grid">
              <div className="lw-col">
                <HourlyCard model={model} T={T} stripRef={stripRef} />
                <RainSoonCard model={model} />
                <DaysCard model={model} T={T} dayIdx={dayIdx} onDay={pickDay} />
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
              <br />Now: UKV analysis corrected by station reports every 15 minutes. Radar: Met Office 1 km composite.
              Chance of rain counts model rain within 10 km; chance of lightning within 16 km.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
