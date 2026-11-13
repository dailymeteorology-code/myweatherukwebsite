/* TCM FROST — MyWeatherUK's own snow model, on a page of its own (Forecast menu).

   Every six hours the model blends every forecast of eight models and their ensembles, each brought
   down to 2 km over the UK and Ireland's hills (tools/tcm-frost), into the chance of snow, a
   four-level snow risk and the snow expected, ten days ahead. The site keeps the last 48 hours of
   runs (server/tcmFrost.js). This page shows a run:

     the map: any of its four layers at any of its times, a chip for each day (that day's highest
       risk and most snow anywhere), the UK and Ireland or one country, the hills shaded beneath;
       tap or click anywhere for that spot's ten days
     snow by place: two dozen towns and snowy spots, day by day
     how the model works, and what each risk level means

   Liquid glass in the site's light and dark themes; the map is always dark, which snow reads best
   on. The map is drawn by components/frost/frostMap, nothing here depends on another page. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Loader2, MapPin, Pause, Play, Snowflake, X } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import { projection } from '@/lib/modelGrids';
import { ukZone } from '@/lib/ukZone';
import { SNOW_RISK_LEVELS, SNOW_RISK_NAMES, snowRiskLevel, cmText } from '@/lib/frostKey';
import { LAYERS, REGIONS, colourOf, drawMap, fetchRuns, fieldCanvas, fit, frostFrame, groundCanvas, loadLines, loadTerrain } from '@/components/frost/frostMap';

const H = 3600e3;
const londonDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const londonMidnight = (day) => {
  const t = Date.parse(`${day}T00:00:00Z`);
  return t - Number(new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' })) * H;
};
const nextDay = (day) => new Date(Date.parse(`${day}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
const clock = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
const weekday = (ms, long) => new Date(ms).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: long ? 'long' : 'short' });
const dateShort = (ms) => new Date(ms).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' });
/* "Today", "Tomorrow", "Sun 15" */
function dayName(day, today = londonDay(Date.now())) {
  if (day === today) return 'Today';
  if (day === nextDay(today)) return 'Tomorrow';
  const t = Date.parse(`${day}T12:00:00Z`);
  return `${new Date(t).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short' })} ${Number(day.slice(8))}`;
}
/* "today", "tomorrow", "on Sunday", and "on Sunday 22nd" from a week out */
function onDay(day, today = londonDay(Date.now())) {
  if (day === today) return 'today';
  if (day === nextDay(today)) return 'tomorrow';
  const t = Date.parse(`${day}T12:00:00Z`), n = Number(day.slice(8));
  const wd = new Date(t).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long' });
  const th = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return (t - Date.parse(`${today}T12:00:00Z`)) / 864e5 >= 6 ? `on ${wd} ${n}${th}` : `on ${wd}`;
}
const runName = (r) => `${String(new Date(r.run).getUTCHours()).padStart(2, '0')}Z ${dateShort(Date.parse(r.run))}`;
const pct = (p) => (p == null ? '—' : p < 1 ? '<1%' : `${Math.round(p)}%`);
const validOf = (run, L) => Date.parse(run.run) + L * H;
const P_UK = projection('uk');

/* towns and snowy spots for the table, north to south */
const PLACES = [
  ['Lerwick', 60.155, -1.145], ['Kirkwall', 58.981, -2.96], ['Inverness', 57.478, -4.224], ['Aviemore', 57.195, -3.825],
  ['Braemar', 57.006, -3.397], ['Aberdeen', 57.149, -2.094], ['Fort William', 56.82, -5.105], ['Glasgow', 55.861, -4.251],
  ['Edinburgh', 55.953, -3.188], ['Leadhills', 55.42, -3.76], ['Newcastle', 54.978, -1.617], ['Alston', 54.811, -2.438],
  ['Belfast', 54.597, -5.93], ['Leeds', 53.8, -1.549], ['Manchester', 53.481, -2.242], ['Buxton', 53.259, -1.911],
  ['Dublin', 53.349, -6.26], ['Birmingham', 52.486, -1.89], ['Brecon', 51.946, -3.388], ['Cardiff', 51.481, -3.179],
  ['London', 51.507, -0.128], ['Princetown', 50.544, -3.99],
];

/* the London days a run covers: the lead at each day's end (the 24 hours to it are the day), and
   the one nearest its midday */
function runDays(run) {
  if (!run?.leads?.length) return [];
  const t0 = Date.parse(run.run), last = validOf(run, run.leads[run.leads.length - 1]);
  const near = (ms, tol) => {
    let best = null, gap = Infinity;
    for (const L of run.leads) { const g = Math.abs(validOf(run, L) - ms); if (g <= tol && g < gap) { best = L; gap = g; } }
    return best;
  };
  const out = [];
  for (let d = londonDay(t0 + H); ; d = nextDay(d)) {
    const start = londonMidnight(d), end = londonMidnight(nextDay(d));
    if (start > last) break;
    out.push({ day: d, end: end <= last + 1.5 * H ? near(end, 1.5 * H) : null, mid: near(start + 12 * H, 3 * H) ?? near(Math.min(last, start + 18 * H), 6 * H), part: start < t0 });
  }
  return out;
}

async function pointAt(lat, lon, tag) {
  const r = await fetch(`/api/frost/point?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}${tag ? `&run=${tag}` : ''}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`TCM FROST: ${r.status}`);
  return r.json();
}

/* ── the map ─────────────────────────────────────────────────────────────── */
function FrostMap({ run, layer, lead, region, pin, onPick }) {
  const wrap = useRef(null), cv = useRef(null);
  const [w, setW] = useState(0);
  const [terrain, setTerrain] = useState(null);
  const [lines, setLines] = useState(null);
  const [frame, setFrame] = useState(null);
  const [hover, setHover] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    loadTerrain().then(setTerrain).catch((e) => setErr(e.message));
    loadLines().then(setLines).catch(() => {});
  }, []);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!run || lead == null) return undefined;
    let live = true;
    frostFrame(run.tag, LAYERS[layer].v, lead).then((f) => live && setFrame({ f, layer })).catch(() => live && setFrame(null));
    const i = run.leads.indexOf(lead);                    // the next time ready for playing
    if (i >= 0 && i + 1 < run.leads.length) frostFrame(run.tag, LAYERS[layer].v, run.leads[i + 1]).catch(() => {});
    return () => { live = false; };
  }, [run, layer, lead]);
  const ground = useMemo(() => (terrain ? groundCanvas(terrain) : null), [terrain]);
  const field = useMemo(() => (frame ? fieldCanvas(frame.f, frame.layer) : null), [frame]);
  const box = REGIONS[region].box;
  const h = w ? Math.round(Math.max(300, Math.min(w * ((box[3] - box[1]) / (box[2] - box[0])), (typeof window !== 'undefined' ? window.innerHeight : 900) * 0.78))) : 0;
  useEffect(() => {
    const c = cv.current;
    if (!c || !w || !h) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    drawMap(c.getContext('2d'), { w, h, dpr, box, ground, field, lines: lines?.lines, cities: lines?.cities, pin });
  }, [w, h, ground, field, lines, region, pin]); // eslint-disable-line react-hooks/exhaustive-deps

  const at = (e) => {
    const r = cv.current.getBoundingClientRect();
    const { s, ox, oy } = fit(box, w, h);
    const gx = (e.clientX - r.left - ox) / s, gy = (e.clientY - r.top - oy) / s;
    return { gx, gy, x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const move = (e) => {
    if (!frame || !w) return;
    const p = at(e), i = Math.floor(p.gy), j = Math.floor(p.gx);
    if (i < 0 || j < 0 || i >= frame.f.head.ny || j >= frame.f.head.nx) { setHover(null); return; }
    const k = i * frame.f.head.nx + j, b = frame.f.q[k];
    setHover({ ...p, v: b === 255 ? null : frame.f.table[b], z: terrain ? terrain.h[k] : null });
  };
  const L = LAYERS[layer];
  const said = (v) => (v == null ? 'outside the model' : layer === 'risk' ? `${SNOW_RISK_NAMES[Math.round(v)] === 'None' ? 'No' : SNOW_RISK_NAMES[Math.round(v)]} risk`
    : layer === 'chance' ? `${pct(v)} chance of snow` : v < 0.2 ? 'no snow' : `${cmText(v)} of snow`);

  return (
    <div ref={wrap} className="fr-map" style={{ height: h || 420 }}>
      <canvas ref={cv} style={{ width: w, height: h }} onPointerMove={move} onPointerLeave={() => setHover(null)}
        onClick={(e) => { const p = at(e); if (p.gx >= 0 && p.gy >= 0) onPick(p); }} aria-label={`Map of ${L.label.toLowerCase()} from TCM FROST. Click anywhere for that spot's ten days.`} role="img" />
      {(!ground || !field) && !err && <div className="fr-map-wait"><Loader2 size={18} className="fr-spin" /> {run ? 'Drawing the map…' : 'Loading the runs…'}</div>}
      {err && <div className="fr-map-wait">The map could not load ({err}).</div>}
      {hover && hover.v !== undefined && (
        <div className="fr-readout" style={{ left: Math.min(hover.x + 14, w - 190), top: Math.max(8, hover.y - 44) }}>
          <b>{said(hover.v)}</b>{hover.z > 0 ? <span>about {Math.round(hover.z / 10) * 10} m up</span> : null}
        </div>
      )}
    </div>
  );
}

/* the key of a layer */
function Key({ layer }) {
  const L = LAYERS[layer];
  return (
    <div className="fr-key" aria-label={`Key: ${L.label}`}>
      {L.key.map(([v, label]) => {
        const c = colourOf(layer, v);
        return <span key={v}><i style={{ background: c ? `rgb(${c[0]},${c[1]},${c[2]})` : 'transparent' }} />{label}</span>;
      })}
      {L.unit && <em>{L.unit}</em>}
    </div>
  );
}

/* a spot's ten days: the chance of snow each period (coloured by its risk) and each day's tile */
function Bars({ point }) {
  const now = Date.now();
  const steps = point.steps.map((s, k) => ({ ...s, t: Date.parse(s.valid), t0: k ? Date.parse(point.steps[k - 1].valid) : Date.parse(point.run) })).filter((s) => s.t > now);
  if (!steps.length) return null;
  const t0 = Math.max(steps[0].t0, now), t1 = steps[steps.length - 1].t, span = t1 - t0;
  const top = Math.max(30, ...steps.map((s) => s.chance * 1.1));
  return (
    <svg className="fr-bars" viewBox="0 0 1000 120" preserveAspectRatio="none" role="img" aria-label="The chance of snow falling here in each period of the next ten days">
      {[25, 50, 75].filter((v) => v < top).map((v) => <line key={v} x1="0" x2="1000" y1={120 - (v / top) * 116} y2={120 - (v / top) * 116} className="fr-guide" />)}
      {steps.map((s) => {
        const x0 = ((Math.max(s.t0, t0) - t0) / span) * 1000, x1 = ((s.t - t0) / span) * 1000;
        const lv = snowRiskLevel(s.risk), hh = Math.max(s.chance >= 1 ? 3 : 1, (s.chance / top) * 116);
        return <rect key={s.lead} x={x0 + 0.6} width={Math.max(0.8, x1 - x0 - 1.2)} y={120 - hh} height={hh} rx="1.5"
          fill={lv ? lv.colour : s.chance >= 1 ? '#dce7f5' : 'rgba(150,170,195,0.25)'}><title>{`${dateShort(s.t)} ${clock(s.t)}: ${pct(s.chance)} chance of snow${lv ? `, ${lv.name} risk` : ''}`}</title></rect>;
      })}
    </svg>
  );
}
function DayTiles({ days, today }) {
  return (
    <div className="fr-tiles">
      {days.map((d) => {
        const lv = snowRiskLevel(d.risk);
        return (
          <div key={d.date} className="fr-tile" style={{ '--c': lv ? lv.colour : 'transparent' }}
            title={`${dayName(d.date, today)}: ${lv ? `${lv.name} risk. ` : 'No risk. '}${cmText(d.cm)} expected; a dusting ${pct(d.p0)}, 1 cm ${pct(d.p1)}, 5 cm ${pct(d.p5)}, 10 cm ${pct(d.p10)}`}>
            <span className="fr-tile-day">{dayName(d.date, today)}</span>
            <b>{d.cm >= 0.2 ? cmText(d.cm) : '—'}</b>
            <span className="fr-tile-risk">{lv ? lv.name : d.p0 >= 5 ? `${pct(d.p0)} chance` : 'None'}</span>
            <span className="fr-tile-p">1 cm+ {pct(d.p1)}</span>
          </div>
        );
      })}
    </div>
  );
}
function PointCard({ pick, point, loading, error, onClose }) {
  const today = londonDay(Date.now());
  const days = (point?.days || []).filter((d) => d.date >= today);
  const worst = days.reduce((a, b) => (!a || b.risk > a.risk || (b.risk === a.risk && b.p1 > a.p1) ? b : a), null);
  const wlv = worst && snowRiskLevel(worst.risk);
  return (
    <section className="fr-card fr-glass fr-point">
      <header className="fr-card-head">
        <div>
          <p className="fr-eyebrow"><MapPin size={12} /> {pick.name || 'The spot you picked'}</p>
          <h2>{pick.lat.toFixed(2)}°N {Math.abs(pick.lon).toFixed(2)}°{pick.lon < 0 ? 'W' : 'E'}{pick.z > 0 ? ` · about ${Math.round(pick.z / 10) * 10} m up` : ''}</h2>
        </div>
        <button type="button" className="fr-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </header>
      {loading && <p className="fr-note"><Loader2 size={14} className="fr-spin" /> Loading the ten days…</p>}
      {error && <p className="fr-note">{error}</p>}
      {!loading && !error && !point && <p className="fr-note">TCM FROST covers the land of the UK and Ireland: pick a spot on land.</p>}
      {point && (
        <>
          <p className="fr-lead">{wlv ? `A ${wlv.name.toLowerCase()} risk of snow ${onDay(worst.date, today)}: a ${pct(worst.p1)} chance of 1 cm or more${worst.cm >= 0.2 ? `, ${cmText(worst.cm)} expected` : ''}.`
            : days.some((d) => d.p0 >= 5) ? 'Little chance of snow in the next ten days.' : 'No snow expected in the next ten days.'}</p>
          <Bars point={point} />
          <DayTiles days={days} today={today} />
          <p className="fr-note">Each day is 00:00 to 24:00. The amounts are fresh snow falling, not the depth lying. <Link to={`/LocationWeather?lat=${pick.lat.toFixed(4)}&lon=${pick.lon.toFixed(4)}${pick.name ? `&name=${encodeURIComponent(pick.name)}` : ''}`}>The full forecast for here</Link></p>
        </>
      )}
    </section>
  );
}

/* ── the page ────────────────────────────────────────────────────────────── */
export default function TCMFrost() {
  const { isDark } = useTheme();
  const [runs, setRuns] = useState(null);
  const [err, setErr] = useState(null);
  const [tag, setTag] = useState('');
  const [layer, setLayer] = useState('risk');
  const [region, setRegion] = useState('ukie');
  const [li, setLi] = useState(null);                       // the time on show: an index into the run's leads
  const [playing, setPlaying] = useState(false);
  const [peaks, setPeaks] = useState({});                   // day -> { risk, cm }
  const [table, setTable] = useState(null);                 // the places' days
  const [pick, setPick] = useState(null);
  const [point, setPoint] = useState({ data: null, loading: false, error: null });

  useEffect(() => {
    let live = true;
    const get = () => fetchRuns().then((rs) => live && setRuns(rs)).catch((e) => live && setErr(e.message));
    get();
    const t = setInterval(get, 10 * 60e3);
    return () => { live = false; clearInterval(t); };
  }, []);
  const run = useMemo(() => (runs?.length ? runs.find((r) => r.tag === tag) || runs[0] : null), [runs, tag]);
  const runKey = run ? `${run.tag}|${run.created}` : '';
  const days = useMemo(() => runDays(run), [runKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the time first shown: the end of the first day with any risk (or of today) */
  useEffect(() => {
    if (!run) return;
    setLi((cur) => {
      if (cur != null && cur < run.leads.length) return cur;
      const d = days.find((x) => x.end != null && x.day >= londonDay(Date.now())) || days[0];
      return Math.max(0, run.leads.indexOf(d?.end ?? run.leads[0]));
    });
  }, [runKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /* each day's highest risk and most snow anywhere, for its chip */
  useEffect(() => {
    if (!run) return undefined;
    let live = true;
    setPeaks({});
    (async () => {
      for (const d of days) {
        if (d.end == null) continue;
        try {
          const [r, a] = await Promise.all([frostFrame(run.tag, 'snow_risk', d.end), frostFrame(run.tag, 'snow_24h', d.end)]);
          let risk = 0, cm = 0;
          for (let i = 0; i < r.q.length; i++) { const b = r.q[i]; if (b !== 255 && b > risk) risk = b; }
          for (let i = 0; i < a.q.length; i++) { const b = a.q[i]; if (b !== 255 && a.table[b] > cm) cm = a.table[b]; }
          if (!live) return;
          setPeaks((p) => ({ ...p, [d.day]: { risk, cm } }));
        } catch { /* a day still to come in a run being mirrored */ }
      }
    })();
    return () => { live = false; };
  }, [runKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /* the places, day by day */
  useEffect(() => {
    if (!run) return undefined;
    let live = true;
    setTable(null);
    Promise.all(PLACES.map(([name, lat, lon]) => pointAt(lat, lon, run.tag).then((p) => ({ name, lat, lon, p })).catch(() => ({ name, lat, lon, p: null }))))
      .then((rows) => live && setTable(rows));
    return () => { live = false; };
  }, [runKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /* the spot picked */
  useEffect(() => {
    if (!pick || !run) return undefined;
    let live = true;
    setPoint({ data: null, loading: true, error: null });
    pointAt(pick.lat, pick.lon, run.tag).then((p) => live && setPoint({ data: p, loading: false, error: null }))
      .catch((e) => live && setPoint({ data: null, loading: false, error: e.message }));
    return () => { live = false; };
  }, [pick, runKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* playing: a step every 0.7 s, round to the start at the end */
  useEffect(() => {
    if (!playing || !run) return undefined;
    const t = setInterval(() => setLi((i) => ((i ?? 0) + 1) % run.leads.length), 700);
    return () => clearInterval(t);
  }, [playing, runKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const lead = run && li != null ? run.leads[Math.min(li, run.leads.length - 1)] : null;
  const shownMs = run && lead != null ? validOf(run, lead) : null;
  const shownDay = shownMs ? londonDay(shownMs - 1) : null;  // a day's end (00:00) belongs to that day
  const goDay = (d) => {
    const L = layer === 'chance' ? d.mid : d.end ?? d.mid;
    if (L != null) { setPlaying(false); setLi(run.leads.indexOf(L)); }
  };
  const onPick = useCallback(({ gx, gy }) => {
    const [lon, lat] = P_UK.fromGrid(gx, gy);
    loadTerrain().then((t) => {
      const k = Math.floor(gy) * t.nx + Math.floor(gx);
      setPick({ lat, lon, gx, gy, z: t.h[k] });
    }).catch(() => setPick({ lat, lon, gx, gy }));
  }, []);
  const pickPlace = (row) => {
    const [gx, gy] = P_UK.toGrid(row.lon, row.lat);
    setPick({ lat: row.lat, lon: row.lon, gx, gy, name: row.name });
    document.getElementById('fr-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const nextRun = run ? Date.parse(run.run) + 6 * H + 8.75 * H : null;
  const today = londonDay(Date.now());
  const tableDays = (table || []).find((r) => r.p)?.p.days.map((d) => d.date).filter((d) => d >= today) || [];

  return (
    <div className={`fr-page${isDark ? '' : ' fr-light'}`}>
      <style>{CSS}</style>
      <div className="fr-ambient" aria-hidden="true"><i /><i /><i /></div>
      <div className="fr-wrap">
        <header className="fr-hero">
          <Link to="/" className="fr-back"><ChevronLeft size={16} /> Home</Link>
          <p className="fr-eyebrow"><Snowflake size={12} /> TCM FROST</p>
          <h1 className="fr-title">Snow for the next ten days</h1>
          <p className="fr-sub">MyWeatherUK’s own snow model: every forecast from eight weather models and their ensembles, each brought down to 2 km over the UK and Ireland’s hills, blended into the chance of snow, the snow risk and the amount expected to fall. Updated every six hours.</p>
          {run && (
            <div className="fr-meta">
              <select className="fr-select" value={tag} onChange={(e) => { setTag(e.target.value); setLi(null); }} aria-label="TCM FROST run">
                <option value="">Latest run · {runName(runs[0])}</option>
                {runs.map((r) => <option key={r.tag} value={r.tag}>Run {runName(r)}</option>)}
              </select>
              <span className="fr-tag">{run.members} forecasts</span>
              <span className="fr-tag">{(run.sources || []).filter((s) => !/_long$/.test(s.name) || s.key === 'ukv').length} model runs</span>
              {!tag && nextRun > Date.now() && <span className="fr-tag">Next run about {clock(nextRun)} {ukZone(nextRun)}</span>}
            </div>
          )}
        </header>

        {err && !runs && <div className="fr-card fr-glass fr-note">TCM FROST could not be loaded ({err}).</div>}
        {runs && !runs.length && <div className="fr-card fr-glass fr-note">The first TCM FROST run is on its way: the model runs every six hours.</div>}

        <section id="fr-map" className="fr-card fr-glass fr-mapcard">
          <div className="fr-tools">
            <div className="fr-seg" role="group" aria-label="Layer">
              {Object.entries(LAYERS).map(([k, l]) => <button key={k} type="button" aria-pressed={layer === k} onClick={() => setLayer(k)}>{l.label}</button>)}
            </div>
            <div className="fr-seg" role="group" aria-label="Area">
              {Object.entries(REGIONS).map(([k, r]) => <button key={k} type="button" aria-pressed={region === k} onClick={() => setRegion(k)}>{r.label}</button>)}
            </div>
          </div>
          {days.length > 0 && (
            <div className="fr-days" role="group" aria-label="Day">
              {days.map((d) => {
                const pk = peaks[d.day], lv = pk && snowRiskLevel(pk.risk);
                return (
                  <button key={d.day} type="button" aria-pressed={shownDay === d.day} onClick={() => goDay(d)} style={{ '--c': lv ? lv.colour : 'rgba(150,170,195,0.35)' }}
                    title={pk ? `${dayName(d.day, today)}: ${lv ? `${lv.name} risk somewhere` : 'no snow risk anywhere'}${pk.cm >= 0.2 ? `, up to ${cmText(pk.cm)} on the highest ground` : ''}` : dayName(d.day, today)}>
                    <b>{dayName(d.day, today)}</b>
                    <span><i />{pk ? (lv ? lv.name : 'None') : d.end == null ? 'part day' : '…'}</span>
                    {pk && pk.cm >= 0.5 && <small>up to {cmText(pk.cm)}</small>}
                  </button>
                );
              })}
            </div>
          )}
          <div className="fr-stage">
            <FrostMap run={run} layer={layer} lead={lead} region={region} pin={pick} onPick={onPick} />
            {shownMs && (
              <div className="fr-when">
                <b>{weekday(shownMs)} {new Date(shownMs).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' })}</b> {clock(shownMs)} {ukZone(shownMs)}
                <span>{LAYERS[layer].what}</span>
              </div>
            )}
            <Key layer={layer} />
          </div>
          {run && (
            <div className="fr-time">
              <button type="button" className="fr-icon" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
              <input type="range" min={0} max={run.leads.length - 1} value={li ?? 0} onChange={(e) => { setPlaying(false); setLi(Number(e.target.value)); }} aria-label="Time" />
              <span className="fr-time-label">T+{lead}</span>
            </div>
          )}
          <p className="fr-hint">Tap or click anywhere on the land for that spot’s ten days.</p>
        </section>

        {pick && <PointCard pick={pick} point={point.data} loading={point.loading} error={point.error} onClose={() => setPick(null)} />}

        <section className="fr-card fr-glass">
          <header className="fr-card-head"><div><p className="fr-eyebrow">Snow by place</p><h2>Each day’s risk and the snow expected</h2></div></header>
          {!table && <p className="fr-note"><Loader2 size={14} className="fr-spin" /> Loading the places…</p>}
          {table && (
            <div className="fr-table-wrap">
              <table className="fr-table">
                <thead><tr><th>Place</th>{tableDays.map((d) => <th key={d}>{dayName(d, today)}</th>)}</tr></thead>
                <tbody>
                  {table.map((row) => (
                    <tr key={row.name} onClick={() => pickPlace(row)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') pickPlace(row); }}>
                      <th>{row.name}</th>
                      {tableDays.map((d) => {
                        const x = row.p?.days.find((y) => y.date === d), lv = x && snowRiskLevel(x.risk);
                        return (
                          <td key={d} style={lv ? { '--c': lv.colour } : undefined} className={lv ? 'is-risk' : ''}
                            title={x ? `${row.name}, ${dayName(d, today)}: ${lv ? `${lv.name} risk, ` : ''}${cmText(x.cm)} expected; 1 cm or more ${pct(x.p1)}` : ''}>
                            {x ? (x.cm >= 0.5 ? cmText(x.cm) : lv ? '·' : '') : '–'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="fr-legend">
            {SNOW_RISK_LEVELS.map((l) => <span key={l.level}><i style={{ background: l.colour }} /><b>{l.name}</b> {l.rule} in 24 hours</span>)}
          </div>
        </section>

        <section className="fr-card fr-glass fr-how">
          <header className="fr-card-head"><div><p className="fr-eyebrow">How TCM FROST works</p><h2>Every forecast, brought down to the hills</h2></div></header>
          <div className="fr-how-grid">
            <div>
              <h3>The forecasts</h3>
              <p>The Met Office UKV (2 km) and Global, ECMWF’s IFS and AIFS, and NOAA’s GFS, with the ECMWF IFS (50 members), ECMWF AIFS (50) and NOAA GEFS (30) ensembles: {run ? `${run.members} forecasts in this run` : 'about 136 forecasts a run'}, all public open data. Where a model’s 06Z or 18Z run stops short of ten days, its longer run carries it on.</p>
            </div>
            <div>
              <h3>Down to 2 km</h3>
              <p>Each forecast is brought down to every 2 km of the UK and Ireland: its temperature moved to the real height of the ground with the model’s own lapse rate, the snow line set by the wet bulb, more snow where hills rise above the model’s smoothed ones, and the snow’s depth from its water by a ratio that depends on the temperature.</p>
            </div>
            <div>
              <h3>Blended</h3>
              <p>The UKV leads the first day or two, the ensembles carry the spread later. The chance of snow is the share of forecasts with at least 0.2 cm; the amount is their probability-matched mean (the pattern of the average, the amounts of the forecasts themselves); the risk comes from the chances of 24-hour totals.</p>
            </div>
            <div>
              <h3>Honestly</h3>
              <p>TCM FROST is new and not yet checked against snow that fell: its chances are the forecasts’ own. Amounts are fresh snow falling, not the depth lying, which melting and drifting change.</p>
            </div>
          </div>
          <p className="fr-note">The same runs are on <Link to="/ModelData">Model Data</Link> (pick TCM FROST, or lay its snow over any model with the Snow overlay) and in each place’s <Link to="/LocationWeather">Location Weather</Link>.</p>
        </section>
      </div>
    </div>
  );
}

const CSS = `
.fr-page { --glass-fill: rgba(255,255,255,0.055); --glass-fill-strong: rgba(255,255,255,0.09); --glass-hairline: rgba(255,255,255,0.11);
  --glass-highlight: rgba(255,255,255,0.15); --glass-shadow: 0 1px 2px rgba(0,0,0,.3), 0 16px 40px -12px rgba(0,0,0,.6);
  --ink-1: #f2f6fc; --ink-2: #a3b3c8; --ink-3: rgba(163,179,200,.7); --page-bg: #060b15; --accent: #4dabf7;
  --amb-a: rgba(77,171,247,.16); --amb-b: rgba(132,94,247,.16); --amb-c: rgba(165,216,255,.12);
  position: relative; min-height: 100vh; background: var(--page-bg); color: var(--ink-1);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Segoe UI Variable Display', 'Segoe UI', Inter, Roboto, sans-serif;
  -webkit-font-smoothing: antialiased; }
.fr-page.fr-light { --glass-fill: rgba(255,255,255,0.66); --glass-fill-strong: rgba(255,255,255,0.88); --glass-hairline: rgba(15,23,42,0.08);
  --glass-highlight: rgba(255,255,255,0.92); --glass-shadow: 0 1px 2px rgba(15,23,42,.05), 0 18px 40px -14px rgba(15,23,42,.2);
  --ink-1: #0b1220; --ink-2: #475a71; --ink-3: rgba(71,90,113,.72); --page-bg: #eef3fb; --accent: #1c7ed6;
  --amb-a: rgba(77,171,247,.14); --amb-b: rgba(132,94,247,.12); --amb-c: rgba(165,216,255,.2); }
.fr-ambient { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.fr-ambient i { position: absolute; display: block; border-radius: 50%; }
.fr-ambient i:nth-child(1) { width: 70vw; height: 70vw; top: -26vw; left: -22vw; background: radial-gradient(circle, var(--amb-a), transparent 62%); }
.fr-ambient i:nth-child(2) { width: 62vw; height: 62vw; top: 10vh; right: -24vw; background: radial-gradient(circle, var(--amb-b), transparent 62%); }
.fr-ambient i:nth-child(3) { width: 64vw; height: 64vw; bottom: -26vw; left: 10vw; background: radial-gradient(circle, var(--amb-c), transparent 62%); }
.fr-wrap { position: relative; z-index: 1; max-width: 1240px; margin: 0 auto; padding: 0 16px 72px; }
.fr-glass { position: relative; border-radius: 24px; background: var(--glass-fill); border: 1px solid var(--glass-hairline);
  -webkit-backdrop-filter: blur(22px) saturate(180%); backdrop-filter: blur(22px) saturate(180%); box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-highlight); }
.fr-hero { padding: clamp(22px, 5vw, 48px) 0 clamp(14px, 3vw, 24px); }
.fr-back { display: inline-flex; align-items: center; gap: 4px; margin-bottom: 18px; padding: 6px 12px 6px 8px; border-radius: 99px; font-size: .84rem; font-weight: 600; color: var(--ink-2); text-decoration: none; background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.fr-back:hover { color: var(--ink-1); background: var(--glass-fill-strong); }
.fr-eyebrow { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; font-size: .7rem; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--ink-3); }
.fr-title { margin: 0; font-size: clamp(2rem, 6vw, 3.4rem); font-weight: 700; letter-spacing: -.035em; line-height: 1.05; text-wrap: balance; }
.fr-sub { margin: 10px 0 0; max-width: 66ch; font-size: clamp(.95rem, 1.6vw, 1.05rem); line-height: 1.55; color: var(--ink-2); }
.fr-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 18px; }
.fr-tag { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 99px; font-size: .8rem; font-weight: 600; color: var(--ink-2); background: var(--glass-fill); border: 1px solid var(--glass-hairline); white-space: nowrap; }
.fr-select { height: 32px; max-width: 100%; padding: 0 14px; border-radius: 99px; font: inherit; font-size: .8rem; font-weight: 650; color: var(--ink-1); background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); cursor: pointer; }
.fr-select option { color: #111; }
.fr-card { margin-top: 16px; padding: clamp(14px, 2.4vw, 22px); }
.fr-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.fr-card-head h2 { margin: 0; font-size: clamp(1.1rem, 2.4vw, 1.4rem); font-weight: 700; letter-spacing: -.02em; }
.fr-note { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; font-size: .85rem; line-height: 1.5; color: var(--ink-2); }
.fr-note a, .fr-hint a { color: var(--accent); font-weight: 650; text-decoration: none; }
.fr-lead { margin: 0 0 10px; font-size: 1rem; line-height: 1.5; font-weight: 600; }
.fr-tools { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; }
.fr-seg { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 3px; max-width: 100%; border-radius: 16px; background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.fr-seg button { border: 0; padding: 6px 11px; border-radius: 12px; font: inherit; font-size: .8rem; font-weight: 650; color: var(--ink-2); background: transparent; cursor: pointer; white-space: nowrap; }
.fr-seg button[aria-pressed='true'] { color: var(--ink-1); background: var(--glass-fill-strong); box-shadow: 0 1px 2px rgba(0,0,0,.12), inset 0 1px 0 var(--glass-highlight); }
.fr-days { display: flex; gap: 6px; margin: 12px 0; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; }
.fr-days button { flex: 0 0 auto; display: grid; gap: 2px; min-width: 84px; padding: 7px 10px; border-radius: 14px; text-align: left; font: inherit; color: var(--ink-1); cursor: pointer;
  background: var(--glass-fill); border: 1px solid var(--glass-hairline); box-shadow: inset 0 3px 0 -1px var(--c); }
.fr-days button[aria-pressed='true'] { background: var(--glass-fill-strong); border-color: var(--c); }
.fr-days b { font-size: .82rem; }
.fr-days span { display: inline-flex; align-items: center; gap: 5px; font-size: .74rem; font-weight: 650; color: var(--ink-2); }
.fr-days span i { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
.fr-days small { font-size: .7rem; color: var(--ink-3); }
.fr-stage { position: relative; border-radius: 18px; overflow: hidden; background: #09121f; }
.fr-map { position: relative; width: 100%; }
.fr-map canvas { display: block; cursor: crosshair; touch-action: manipulation; }
.fr-map-wait { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: .9rem; color: #c8d6e8; }
.fr-readout { position: absolute; display: grid; gap: 1px; padding: 6px 10px; border-radius: 10px; font-size: .78rem; color: #f2f6fc; background: rgba(6,12,22,.82); border: 1px solid rgba(255,255,255,.14); pointer-events: none; white-space: nowrap; }
.fr-readout span { color: #a3b3c8; font-size: .72rem; }
.fr-when { position: absolute; top: 12px; left: 12px; display: grid; gap: 2px; padding: 8px 12px; border-radius: 14px; font-size: .9rem; color: #f2f6fc; background: rgba(6,12,22,.62); border: 1px solid rgba(255,255,255,.12); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); max-width: calc(100% - 24px); pointer-events: none; }
.fr-when span { font-size: .72rem; color: #a3b3c8; }
.fr-key { position: absolute; left: 12px; bottom: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 7px 11px; border-radius: 12px; font-size: .72rem; font-weight: 650; color: #dbe5f2; background: rgba(6,12,22,.62); border: 1px solid rgba(255,255,255,.12); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); max-width: calc(100% - 24px); pointer-events: none; }
.fr-key span { display: inline-flex; align-items: center; gap: 4px; }
.fr-key i { width: 12px; height: 9px; border-radius: 3px; }
.fr-key em { font-style: normal; color: #a3b3c8; }
.fr-time { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.fr-time input { flex: 1; min-width: 0; accent-color: var(--accent); }
.fr-time-label { font-size: .8rem; font-weight: 650; color: var(--ink-2); font-variant-numeric: tabular-nums; min-width: 48px; text-align: right; }
.fr-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 99px; border: 1px solid var(--glass-hairline); background: var(--glass-fill-strong); color: var(--ink-1); cursor: pointer; flex: 0 0 auto; }
.fr-hint { margin: 8px 0 0; font-size: .78rem; color: var(--ink-3); }
.fr-spin { animation: fr-spin 1s linear infinite; }
@keyframes fr-spin { to { transform: rotate(360deg); } }
.fr-bars { display: block; width: 100%; height: 110px; margin: 4px 0 10px; }
.fr-guide { stroke: var(--glass-hairline); stroke-width: 1; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }
.fr-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 6px; }
.fr-tile { display: grid; gap: 2px; padding: 8px 10px; border-radius: 14px; background: var(--glass-fill); border: 1px solid var(--glass-hairline); box-shadow: inset 0 3px 0 -1px var(--c); }
.fr-tile-day { font-size: .76rem; font-weight: 700; color: var(--ink-2); }
.fr-tile b { font-size: 1.05rem; letter-spacing: -.01em; }
.fr-tile-risk { font-size: .74rem; font-weight: 650; }
.fr-tile-p { font-size: .7rem; color: var(--ink-3); }
.fr-table-wrap { overflow-x: auto; margin: 0 -4px; padding: 0 4px; }
.fr-table { width: 100%; border-collapse: separate; border-spacing: 3px; font-size: .8rem; }
.fr-table th { font-weight: 650; color: var(--ink-2); text-align: left; white-space: nowrap; padding: 4px 6px; }
.fr-table thead th { font-size: .74rem; color: var(--ink-3); text-align: center; }
.fr-table thead th:first-child { text-align: left; }
.fr-table tbody tr { cursor: pointer; }
.fr-table tbody tr:hover th { color: var(--ink-1); }
.fr-table td { min-width: 46px; height: 30px; text-align: center; border-radius: 8px; font-weight: 700; font-variant-numeric: tabular-nums; background: var(--glass-fill); color: var(--ink-1); }
.fr-table td.is-risk { background: color-mix(in srgb, var(--c) 72%, transparent); color: #071120; }
.fr-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 12px; font-size: .78rem; color: var(--ink-2); }
.fr-legend span { display: inline-flex; align-items: center; gap: 6px; }
.fr-legend i { width: 12px; height: 9px; border-radius: 3px; }
.fr-legend b { color: var(--ink-1); }
.fr-how-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px 22px; }
.fr-how h3 { margin: 0 0 4px; font-size: .95rem; }
.fr-how p { margin: 0; font-size: .86rem; line-height: 1.55; color: var(--ink-2); }
.fr-point h2 { font-size: clamp(1rem, 2.2vw, 1.2rem); }
@media (max-width: 640px) {
  .fr-tools { flex-direction: column; align-items: stretch; }
  .fr-seg { width: 100%; }
  .fr-seg button { flex: 1 1 auto; }
  .fr-when { font-size: .8rem; }
}
`;
