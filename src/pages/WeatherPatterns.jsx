/* Weather Patterns — the pattern most likely to run each of the next two weeks, and its rivals.

   Every day at 12:00 UK time the server blends the newest ECMWF and GFS runs, main runs and
   ensembles (server/patterns/engine.py), names each run's week by its dominant pattern (Atlantic
   westerlies, a Scandinavian high, a high over the UK...) and groups the runs by pattern. This page
   shows the result, week by week, not day by day: the two weeks' likeliest patterns at the top, a
   tab per week with every pattern's chance, and up to three pattern cards, most likely first, each
   with its chance, the pattern's chart, what it means for the week, the week's rain, temperature
   and wind against normal, and which models back it. Issues from before 26 Oct 2026 had no named
   patterns; picked from the list, they show their scenarios day by day as they were made.

   While the 12:00 run is going the page follows it: the new issue appears week by week as it is
   finished, its scenarios revealed one after another, and the week still being worked out shows
   placeholders with the run's progress. Earlier issues (the last 30) can be picked from a list.

   Liquid glass in the site's light and dark themes; nothing here depends on another page. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Info, Loader2, Pause, Play, RefreshCw } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import PatternMap, { buildLand } from '@/components/patterns/patternMap';
import PatternIcon, { GustIcon } from '@/components/patterns/PatternIcon';

const ACCENTS = ['#ec5f86', '#9b6fe3', '#3d8ef0'];
/* each named pattern's colour in the chance bars: highs warm, lows and westerlies blue, northerly
   and blocking patterns cold */
const PATTERN_COLOUR = {
  stormy_westerlies: '#3f5be0', westerlies: '#3d8ef0', westerly: '#5aa7e8', uk_trough: '#7b61d9', southern_track: '#a678e8',
  scandi_high: '#f2a93a', uk_high: '#f6c945', euro_high: '#f08b4c', atlantic_ridge: '#4fbf8a', northern_block: '#4fc3d9',
  northwesterly: '#7fb0e0', northerly: '#9ad8f2', easterly: '#e6a0c0', southerly: '#f07a5a', southwesterly: '#e8b46a', slack: '#9aa7b8',
};
const MODEL_ORDER = ['ens', 'hres', 'gefs', 'gfs'];
const MODEL_COLOUR = { ens: '#3b82f6', hres: '#93c5fd', gefs: '#f97316', gfs: '#fdba74' };
const REGION = {
  England_SE_and_Central_S: 'SE & central S England', England_SW_and_S_Wales: 'SW England & S Wales', East_Anglia: 'East Anglia',
  Midlands: 'Midlands', England_E_and_NE: 'E & NE England', England_NW_and_N_Wales: 'NW England & N Wales',
  Scotland_N: 'N Scotland', Scotland_E: 'E Scotland', Scotland_W: 'W Scotland', Northern_Ireland: 'Northern Ireland',
};

/* ── data ───────────────────────────────────────────────────────────────── */

function usePatterns(issueId) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const last = useRef('');
  const running = !!state.data?.meta?.status?.running;
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/patterns${issueId ? `?issue=${issueId}` : ''}`, { signal: ac.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then((text) => {
        // the page polls; an unchanged answer must not re-render the cards (the day picked on a
        // map, a playing week and the charts would all start again)
        if (text === last.current) return;
        last.current = text;
        setState({ data: JSON.parse(text), error: null, loading: false });
      })
      .catch((e) => { if (e.name !== 'AbortError') setState((s) => ({ ...s, error: e.message, loading: false })); });
    return () => ac.abort();
  }, [issueId, tick]);
  // follow a run closely; otherwise look for a new issue now and then
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) setTick((n) => n + 1); }, running ? 15e3 : 5 * 60e3);
    return () => clearInterval(t);
  }, [running]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}

let landPromise = null;
function useLand() {
  const [land, setLand] = useState(null);
  useEffect(() => {
    let live = true;
    landPromise ||= fetch('/api/patterns/land').then((r) => (r.ok ? r.json() : null)).then((j) => buildLand(j)).catch(() => null);
    landPromise.then((d) => { if (!d) landPromise = null; if (live) setLand(d); });
    return () => { live = false; };
  }, []);
  return land;
}

/* ── formatting ─────────────────────────────────────────────────────────── */

const ukFmt = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ...opts });
const dayOf = (iso) => new Date(`${iso}T12:00:00Z`);
const fmtDay = (iso, opts) => ukFmt(opts).format(dayOf(iso));
const fmtWhen = (iso) => `${ukFmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso))}, ${ukFmt({ hour: '2-digit', minute: '2-digit' }).format(new Date(iso))}`;
const idToIso = (id) => `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T${id.slice(8, 10)}:${id.slice(10, 12)}:00Z`;
/** "Wednesday's 00 UTC model runs": model runs are named by their UTC start time. */
const runLabel = (iso) => {
  const d = new Date(iso);
  return `${new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' }).format(d)}'s ${String(d.getUTCHours()).padStart(2, '0')} UTC model runs`;
};
const signed = (v, dp = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(dp)}`;
function weekRange(w) {
  const a = dayOf(w.start), b = dayOf(w.end);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  return `${ukFmt({ weekday: 'short', day: 'numeric', ...(sameMonth ? {} : { month: 'short' }) }).format(a)} – ${ukFmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(b)}`;
}
const windWord = (g) => (g >= 30 ? 'Gales' : g >= 22 ? 'Windy' : g >= 14 ? 'Breezy' : 'Light winds');
const dayWind = (d) => (d.gale >= 0.4 || d.G >= 30 ? 'gales' : d.G >= 22 ? 'windy' : '');
/** How sure the week is: how far the likeliest pattern stands out. */
function confidence(w) {
  const top = w.scenarios[0]?.chance ?? 0;
  if (top >= 55) return ['High', 'one pattern stands out'];
  if (top >= 42) return ['Medium', 'one pattern is favoured, but the others are real possibilities'];
  return ['Low', 'no pattern stands out'];
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function ChanceRing({ pct, colour }) {
  const r = 22, c = 2 * Math.PI * r;
  return (
    <div className="wp-ring" aria-label={`${pct}% chance`}>
      <svg viewBox="0 0 56 56" width="56" height="56">
        <circle cx="28" cy="28" r={r} className="wp-ring-track" />
        <circle cx="28" cy="28" r={r} fill="none" stroke={colour} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 28 28)" className="wp-ring-arc" />
      </svg>
      <b>{pct}<small>%</small></b>
    </div>
  );
}

function ModelMix({ mix, info }) {
  const parts = MODEL_ORDER.filter((m) => mix[m]?.share > 0);
  return (
    <div className="wp-mix">
      <div className="wp-mix-bar" role="img" aria-label="Share of each model in this scenario">
        {parts.map((m) => <i key={m} style={{ width: `${mix[m].share * 100}%`, background: MODEL_COLOUR[m] }} />)}
      </div>
      <div className="wp-mix-key">
        {MODEL_ORDER.filter((m) => mix[m]).map((m) => (
          <span key={m} className={mix[m].n ? undefined : 'wp-mix-none'}>
            <i style={{ background: MODEL_COLOUR[m] }} />{info?.[m]?.short || m}<b>{mix[m].n}/{mix[m].of}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function PatternChances({ list }) {
  const shown = list.filter((p) => p.chance >= 1);
  const rest = 100 - shown.reduce((a, p) => a + p.chance, 0);
  return (
    <div className="wp-pchances wp-glass">
      <span className="wp-pchances-label">Every pattern the runs show this week</span>
      <div className="wp-pbar2" role="img" aria-label={shown.map((p) => `${p.name} ${Math.round(p.chance)}%`).join(', ')}>
        {shown.map((p) => <i key={p.key} style={{ flex: p.chance, background: PATTERN_COLOUR[p.key] || '#9aa7b8' }} title={`${p.name}: ${Math.round(p.chance)}%`} />)}
        {rest > 0.5 && <i style={{ flex: rest, background: 'var(--glass-fill-strong)' }} />}
      </div>
      <div className="wp-pkey">
        {shown.map((p) => (
          <span key={p.key} className={p.shown ? 'wp-pkey-shown' : undefined}>
            <i style={{ background: PATTERN_COLOUR[p.key] || '#9aa7b8' }} />{p.name}<b>{Math.round(p.chance)}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/* the two weeks at a glance: each week's likeliest pattern and the one after it */
function Outlook({ weeks, onPick }) {
  const tops = weeks.map((w) => w.scenarios[0]).filter(Boolean);
  if (!tops.length || !tops[0].pattern) return null;
  return (
    <div className="wp-outlook wp-glass">
      {weeks.map((w, k) => {
        const [a, b] = w.scenarios;
        return (
          <button key={w.n} type="button" className="wp-outlook-week" onClick={() => onPick(k)}>
            <span className="wp-outlook-when">Week {w.n} · {weekRange(w)}</span>
            <span className="wp-outlook-main"><i style={{ background: PATTERN_COLOUR[a.pattern] }} />{a.title}<b>{a.chance}%</b></span>
            {b && <span className="wp-outlook-alt">Alternative: {b.title} ({b.chance}%)</span>}
          </button>
        );
      })}
    </div>
  );
}

function DayStrip({ days, sel, onPick, accent }) {
  return (
    <div className="wp-days" role="tablist" aria-label="Days of the week">
      {days.map((d, i) => (
        <button key={d.date} type="button" role="tab" aria-selected={i === sel} className="wp-day" onClick={() => onPick(i)}
          style={i === sel ? { '--sel': accent } : undefined}
          title={`${fmtDay(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}: high ${Math.round(d.tmax)}°C, low ${Math.round(d.tmin)}°C, ${d.rain.toFixed(1)} mm rain, ${windWord(d.G).toLowerCase()}`}>
          <span className="wp-day-name">{fmtDay(d.date, { weekday: 'short' })}</span>
          <PatternIcon kind={d.icon} size={28} />
          <span className="wp-day-t"><b>{Math.round(d.tmax)}°</b><em>{Math.round(d.tmin)}°</em></span>
          <span className="wp-day-r">{d.rain < 0.5 ? 'dry' : `${d.rain < 10 ? d.rain.toFixed(1) : Math.round(d.rain)} mm`}</span>
          <span className="wp-day-w">{dayWind(d) ? <><GustIcon size={11} title={dayWind(d)} />{dayWind(d)}</> : ' '}</span>
        </button>
      ))}
    </div>
  );
}

/* the week's rain, temperature and wind against normal */
function WeekFacts({ s, strongest }) {
  const wk = s.week;
  const rainPct = wk.rainNormal > 0 ? Math.round((100 * wk.rain) / wk.rainNormal) : null;
  const regions = Object.entries(wk.rainRegions || {}).sort((a, b) => b[1] - a[1]);
  const gMax = Math.max(...s.days.map((x) => x.G));
  return (
    <div className="wp-factbox"><div className="wp-facts">
      <div className="wp-fact">
        <span>Rain</span>
        <b>{Math.round(wk.rain)} mm</b>
        {rainPct != null && <em className={rainPct >= 130 ? 'wp-up' : rainPct < 70 ? 'wp-down' : undefined}>{rainPct}% of normal</em>}
        {regions.length > 1 && <em>Most in {REGION[regions[0][0]] || regions[0][0]}</em>}
      </div>
      <div className="wp-fact">
        <span>Temperature</span>
        <b>{signed(wk.tmaxAnom)}°C</b>
        <em>by day vs normal</em>
        <em>{signed(wk.tminAnom)}°C at night{wk.frostNights ? ` · ${wk.frostNights} frosty` : ''}</em>
      </div>
      <div className="wp-fact">
        <span>Wind</span>
        <b>{wk.galeDays ? `${wk.galeDays} gale day${wk.galeDays > 1 ? 's' : ''}` : windWord(gMax)}</b>
        <em>{strongest ? `Strongest on ${fmtDay(s.days.reduce((a, x) => (x.G > a.G ? x : a)).date, { weekday: 'long' })}` : 'at its strongest in the week'}</em>
      </div>
    </div></div>
  );
}

/* one of the week's patterns: its chance, its chart (the average of its runs on the days that have
   it), what it means for the week, and the week's facts */
function PatternCard({ s, index, landPath, grid, info, uid }) {
  const accent = ACCENTS[index] || ACCENTS[2];
  return (
    <article className="wp-card wp-card-week wp-glass" style={{ '--i': index, '--accent': accent }}>
      <header className="wp-card-head">
        <ChanceRing pct={s.chance} colour={accent} />
        <div className="wp-card-heading">
          <span className="wp-scn">Pattern {s.rank} · {s.likelihood}</span>
          <h3>{s.title}</h3>
        </div>
      </header>
      <div className="wp-chips">{s.chips.map((c) => <span key={c} className="wp-chip">{c}</span>)}</div>

      <div className="wp-map">
        <PatternMap landPath={landPath} msl={s.weekMsl} grid={grid} centres={s.weekCentres} uid={uid} />
        <div className="wp-map-top"><span className="wp-map-day">The pattern’s chart · {weekRange({ start: s.days[0].date, end: s.days[s.days.length - 1].date })}</span></div>
        {!landPath && <div className="wp-map-wait"><Loader2 size={16} className="wp-spin" /></div>}
      </div>

      <p className="wp-desc">{s.about} {s.description}</p>
      <WeekFacts s={s} />
      <div className="wp-support">
        <ModelMix mix={s.mix} info={info} />
        <p>{s.support}</p>
      </div>
    </article>
  );
}

/* a scenario of an issue made before the patterns were named: its chart day by day */
function ScenarioCard({ s, index, landPath, grid, info, uid }) {
  const accent = ACCENTS[index] || ACCENTS[2];
  const [day, setDay] = useState(s.keyDay ?? 3);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => setDay((d) => (d + 1) % s.days.length), 1500);
    return () => clearInterval(t);
  }, [playing, s.days.length]);
  const d = s.days[day];
  return (
    <article className="wp-card wp-glass" style={{ '--i': index, '--accent': accent }}>
      <header className="wp-card-head">
        <ChanceRing pct={s.chance} colour={accent} />
        <div className="wp-card-heading">
          <span className="wp-scn">Scenario {s.rank} · {s.likelihood}</span>
          <h3>{s.title}</h3>
        </div>
      </header>
      <div className="wp-chips">{s.chips.map((c) => <span key={c} className="wp-chip">{c}</span>)}</div>

      <div className="wp-map">
        <PatternMap landPath={landPath} msl={d.msl} grid={grid} centres={d.centres} uid={uid} />
        <div className="wp-map-top">
          <span className="wp-map-day">{fmtDay(d.date, { weekday: 'long', day: 'numeric', month: 'short' })} · midday</span>
          <button type="button" className="wp-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play the week'}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
        </div>
        {!landPath && <div className="wp-map-wait"><Loader2 size={16} className="wp-spin" /></div>}
      </div>
      <DayStrip days={s.days} sel={day} onPick={(i) => { setPlaying(false); setDay(i); }} accent={accent} />

      <p className="wp-desc">{s.description}</p>
      <WeekFacts s={s} strongest />
      <div className="wp-support">
        <ModelMix mix={s.mix} info={info} />
        <p>{s.support}</p>
      </div>
    </article>
  );
}

function PendingCard({ index, pct }) {
  return (
    <article className="wp-card wp-glass wp-pending" style={{ '--i': index, '--accent': ACCENTS[index] }}>
      <header className="wp-card-head">
        <div className="wp-ring wp-ring-wait"><Loader2 size={20} className="wp-spin" /></div>
        <div className="wp-card-heading">
          <span className="wp-scn">Pattern {index + 1}</span>
          <h3>Being worked out…</h3>
        </div>
      </header>
      <div className="wp-map wp-shimmer" />
      <div className="wp-lines"><i /><i /><i /></div>
      {pct != null && <div className="wp-pbar"><i style={{ width: `${pct}%` }} /></div>}
    </article>
  );
}

const STAGE = { starting: 'Starting', runs: 'Finding the newest model runs', download: 'Downloading model data', cluster: 'Naming each run’s pattern', week: 'Writing up', done: 'Finished' };

function RunBanner({ status, issue }) {
  if (!status?.running) return null;
  const weekPct = status.week ? Math.max(0, Math.min(100, (status.pct - (status.week - 1) * 49 - 2) / 0.47)) : status.pct;
  return (
    <div className="wp-banner wp-glass" role="status">
      <Loader2 size={16} className="wp-spin" />
      <div>
        <b>A new issue is being made.</b>{' '}
        <span>{STAGE[status.stage] || 'Working'}{status.week ? ` for week ${status.week}` : ''}{status.stage === 'download' ? ` (${Math.round(weekPct)}%)` : ''}.
          {issue?.status === 'building' ? ' Finished weeks are shown as they are ready.' : ' The last issue is shown until the first week is ready.'}</span>
      </div>
      <div className="wp-pbar"><i style={{ width: `${status.pct}%` }} /></div>
    </div>
  );
}

function HowItWorks({ issue }) {
  const [open, setOpen] = useState(false);
  const w1 = issue?.weeks?.[0]?.models || {};
  const w2 = issue?.weeks?.[1]?.models || {};
  const pc = (o, m) => (o[m] ? `${Math.round(o[m].weight * 100)}%` : '—');
  return (
    <section className="wp-how wp-glass">
      <button type="button" className="wp-how-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Info size={16} /> <b>How the patterns are worked out</b> <span>{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="wp-how-body">
          <p>Every day at 12:00 UK time the newest runs of the two leading global weather models are taken: the European Centre for Medium-Range Weather Forecasts (ECMWF) and the United States’ Global Forecast System (GFS). From each come its main, highest-detail run and its ensemble, a set of runs started from slightly different conditions to show how the forecast could go: 50 runs from the ECMWF ensemble and 31 from the Global Ensemble Forecast System (GEFS).</p>
          <p>The runs are blended into one forecast, each model counting for a set share however many runs it has:</p>
          <table className="wp-weights">
            <thead><tr><th>Model</th><th>Week 1</th><th>Week 2</th></tr></thead>
            <tbody>
              <tr><td>ECMWF ensemble (50 runs)</td><td>{pc(w1, 'ens')}</td><td>{pc(w2, 'ens')}</td></tr>
              <tr><td>GFS ensemble, GEFS (31 runs)</td><td>{pc(w1, 'gefs')}</td><td>{pc(w2, 'gefs')}</td></tr>
              <tr><td>ECMWF main run</td><td>{pc(w1, 'hres')}</td><td>{pc(w2, 'hres')}</td></tr>
              <tr><td>GFS main run</td><td>{pc(w1, 'gfs')}</td><td>{pc(w2, 'gfs')}</td></tr>
            </tbody>
          </table>
          <p>ECMWF counts for more because it has the better record at this range. The ECMWF main run only reaches ten days, so it sits out week 2, and the GFS main run counts for little there: a single run has little skill left that far ahead.</p>
          <p>Each of a run’s seven midday pressure charts is named by where its highs and lows sit around the UK and the flow they make: Atlantic westerlies (stormy when the low near Iceland is deep and the flow strong), a Scandinavian high, northern blocking, a mid-Atlantic ridge, a high over the UK or over the continent, a trough over the UK, lows on a southern track, or simply the flow when there is no clear pattern. The run’s week is the pattern on most of its days; when two tie, the one the week settles into. A pattern’s chance is the weighted share of the runs that show it. Every pattern the runs show is listed with its chance; up to three are shown in full, the likeliest first.</p>
          <p>A pattern’s chart is the average of its runs on the days that have it. Its temperatures and rain come from the same runs at about 550 points over the UK, compared district by district with the 1991–2020 averages from the Met Office HadUK-Grid climate series. Wind comes from each run’s pressure gradient over the UK (the Jenkinson–Collison gale index), and the weather type from the same method’s objective Lamb classification. The description is written from all of this.</p>
          <p className="wp-src">Data: ECMWF open data (© ECMWF, CC BY 4.0); NOAA GFS and GEFS (public domain); climate averages © Crown copyright, Met Office, Open Government Licence. Map coastlines from ECMWF’s land-sea mask.</p>
        </div>
      )}
    </section>
  );
}

/* ── page ───────────────────────────────────────────────────────────────── */

export default function WeatherPatterns() {
  const { isDark } = useTheme();
  const { user } = useAuth() || {};
  const isAdmin = user?.role === 'admin';
  const [issueId, setIssueId] = useState('');
  const { data, error, loading, reload } = usePatterns(issueId);
  const landPath = useLand();
  const [week, setWeek] = useState(0);
  const [runMsg, setRunMsg] = useState(null);
  const issue = data?.issue;
  const meta = data?.meta;
  const status = meta?.status;
  const weeks = issue?.weeks || [];
  const totalWeeks = issue?.status === 'building' ? 2 : weeks.length;
  const w = weeks[week];
  const seen = useRef(new Set());
  const fresh = w ? !seen.current.has(`${issue.id}:${week}`) : false;
  useEffect(() => { if (w) seen.current.add(`${issue.id}:${week}`); }, [w, issue?.id, week]);

  const runNow = async () => {
    setRunMsg('Starting…');
    try {
      const token = base44.auth.getToken();
      const r = await fetch('/api/patterns/run', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const j = await r.json().catch(() => ({}));
      setRunMsg(r.ok ? (j.started ? 'Update started.' : 'An update is already running.') : (j.error || `Failed (${r.status})`));
      reload();
    } catch (e) {
      setRunMsg(e.message);
    }
  };

  const issues = meta?.issues || [];
  const nextAt = meta?.next ? fmtWhen(meta.next) : null;

  return (
    <div className={`wp-page${isDark ? '' : ' wp-light'}`}>
      <style>{CSS}</style>
      <div className="wp-ambient" aria-hidden="true"><i /><i /><i /></div>
      <div className="wp-wrap">
        <header className="wp-hero">
          <Link to="/" className="wp-back"><ChevronLeft size={16} /> Home</Link>
          <p className="wp-eyebrow">Weather Patterns</p>
          <h1 className="wp-title">The next two weeks’ weather patterns</h1>
          <p className="wp-sub">The weather pattern most likely to run each of the next two weeks, and the patterns that could take over instead, from the ECMWF and GFS models blended together. Updated every day at 12:00.</p>
          {issue && (
            <div className="wp-meta">
              <span className="wp-tag">Issued {fmtWhen(issue.issued)}</span>
              {issue.runs?.ens && <span className="wp-tag">{runLabel(issue.runs.ens)}</span>}
              {nextAt && !issueId && <span className="wp-tag">Next update {nextAt}</span>}
              {issues.length > 1 && (
                <select className="wp-select" value={issueId} onChange={(e) => { setIssueId(e.target.value); setWeek(0); }} aria-label="Issue">
                  <option value="">Latest issue</option>
                  {issues.map((id) => <option key={id} value={id}>{fmtWhen(idToIso(id))}</option>)}
                </select>
              )}
              {isAdmin && (
                <button type="button" className="wp-tag wp-run" onClick={runNow} disabled={status?.running}>
                  <RefreshCw size={13} className={status?.running ? 'wp-spin' : undefined} /> {status?.running ? 'Updating…' : 'Update now'}
                </button>
              )}
              {isAdmin && runMsg && <span className="wp-note">{runMsg}</span>}
            </div>
          )}
        </header>

        {!issueId && <RunBanner status={status} issue={issue} />}
        {isAdmin && status?.lastError && !status.running && <div className="wp-banner wp-glass wp-err">Last update failed: {status.lastError}</div>}

        {loading && !data && <div className="wp-empty wp-glass"><Loader2 size={20} className="wp-spin" /> Loading the patterns…</div>}
        {error && !data && <div className="wp-empty wp-glass">The patterns could not be loaded ({error}). <button type="button" className="wp-tag" onClick={reload}>Try again</button></div>}
        {data && !issue && (
          <div className="wp-empty wp-glass">
            <b>The first issue is being made.</b>
            <span>The scenarios appear here as soon as week 1 is finished.</span>
          </div>
        )}

        {issue && (
          <>
            <Outlook weeks={weeks} onPick={setWeek} />
            <nav className="wp-weeks wp-glass" aria-label="Week">
              {Array.from({ length: totalWeeks }, (_, k) => (
                <button key={k} type="button" aria-pressed={k === week} onClick={() => setWeek(k)}>
                  <b>{k === 0 ? 'Week 1' : 'Week 2'}</b>
                  <span>{weeks[k] ? weekRange(weeks[k]) : 'Being worked out…'}</span>
                </button>
              ))}
            </nav>
            {w ? (
              <>
                <div className="wp-weekline">
                  <span>{fmtDay(w.start, { weekday: 'long', day: 'numeric', month: 'long' })} to {fmtDay(w.end, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                  <span className="wp-conf">Confidence <b>{confidence(w)[0]}</b>: {confidence(w)[1]} · {w.runs} model runs blended</span>
                </div>
                {w.patterns && <PatternChances list={w.patterns} />}
                <div className={`wp-grid${fresh ? ' wp-reveal' : ''}`} key={`${issue.id}:${week}`}>
                  {w.scenarios.map((s, i) => {
                    const Card = s.weekMsl ? PatternCard : ScenarioCard;
                    return <Card key={`${issue.id}:${week}:${i}`} s={s} index={i} landPath={landPath} grid={issue.map} info={issue.modelInfo} uid={`${week}-${i}`} />;
                  })}
                </div>
              </>
            ) : (
              <div className="wp-grid">
                {[0, 1, 2].map((i) => <PendingCard key={i} index={i} pct={status?.running && status.week === week + 1 ? status.pct : null} />)}
              </div>
            )}
            <HowItWorks issue={issue} />
          </>
        )}
      </div>
    </div>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const CSS = `
.wp-page { --glass-fill: rgba(255,255,255,0.055); --glass-fill-strong: rgba(255,255,255,0.09); --glass-hairline: rgba(255,255,255,0.11);
  --glass-highlight: rgba(255,255,255,0.15); --glass-shadow: 0 1px 2px rgba(0,0,0,.3), 0 16px 40px -12px rgba(0,0,0,.6);
  --ink-1: #f2f6fc; --ink-2: #a3b3c8; --ink-3: rgba(163,179,200,.66); --page-bg: #070c16;
  --amb-a: rgba(236,95,134,.18); --amb-b: rgba(155,111,227,.2); --amb-c: rgba(61,142,240,.2);
  --wp-sea: #0a1220; --wp-land: #283a57; --wp-coast: rgba(196,214,238,.45); --wp-iso: rgba(222,232,246,.55); --wp-iso-major: rgba(240,246,255,.85);
  --wp-label-halo: #0a1220; --wp-high: #f6a83c; --wp-low: #4f9bff; --wp-cloud: #e8eef7; --wp-cloud-dark: #9fb0c6; --wp-gust: #9fb0c6;
  position: relative; min-height: 100vh; background: var(--page-bg); color: var(--ink-1);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Segoe UI Variable Display', 'Segoe UI', Inter, Roboto, sans-serif;
  -webkit-font-smoothing: antialiased; }
.wp-page.wp-light { --glass-fill: rgba(255,255,255,0.66); --glass-fill-strong: rgba(255,255,255,0.86); --glass-hairline: rgba(15,23,42,0.08);
  --glass-highlight: rgba(255,255,255,0.92); --glass-shadow: 0 1px 2px rgba(15,23,42,.05), 0 18px 40px -14px rgba(15,23,42,.2);
  --ink-1: #0b1220; --ink-2: #475a71; --ink-3: rgba(71,90,113,.7); --page-bg: #eef3fb;
  --amb-a: rgba(236,95,134,.14); --amb-b: rgba(155,111,227,.14); --amb-c: rgba(61,142,240,.16);
  --wp-sea: #d9e6f4; --wp-land: #ffffff; --wp-coast: #a9bbd0; --wp-iso: rgba(64,82,108,.55); --wp-iso-major: rgba(40,56,80,.85);
  --wp-label-halo: #d9e6f4; --wp-high: #e08a12; --wp-low: #2f7de6; --wp-cloud: #a9b8ca; --wp-cloud-dark: #73869d; --wp-gust: #6b7d94; }
.wp-ambient { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.wp-ambient i { position: absolute; display: block; border-radius: 50%; }
.wp-ambient i:nth-child(1) { width: 70vw; height: 70vw; top: -26vw; left: -22vw; background: radial-gradient(circle, var(--amb-a), transparent 62%); }
.wp-ambient i:nth-child(2) { width: 62vw; height: 62vw; top: 10vh; right: -24vw; background: radial-gradient(circle, var(--amb-b), transparent 62%); }
.wp-ambient i:nth-child(3) { width: 64vw; height: 64vw; bottom: -26vw; left: 10vw; background: radial-gradient(circle, var(--amb-c), transparent 62%); }
.wp-wrap { position: relative; z-index: 1; max-width: 1320px; margin: 0 auto; padding: 0 16px 72px; }
.wp-glass { position: relative; border-radius: 24px; background: var(--glass-fill); border: 1px solid var(--glass-hairline);
  -webkit-backdrop-filter: blur(22px) saturate(180%); backdrop-filter: blur(22px) saturate(180%); box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-highlight); }
.wp-hero { padding: clamp(22px, 5vw, 48px) 0 clamp(14px, 3vw, 24px); }
.wp-back { display: inline-flex; align-items: center; gap: 4px; margin-bottom: 18px; padding: 6px 12px 6px 8px; border-radius: 99px; font-size: .84rem; font-weight: 600; color: var(--ink-2); text-decoration: none; background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.wp-back:hover { color: var(--ink-1); background: var(--glass-fill-strong); }
.wp-eyebrow { margin: 0 0 6px; font-size: .7rem; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--ink-3); }
.wp-title { margin: 0; font-size: clamp(2rem, 6vw, 3.4rem); font-weight: 700; letter-spacing: -.035em; line-height: 1.05; text-wrap: balance; }
.wp-sub { margin: 10px 0 0; max-width: 64ch; font-size: clamp(.95rem, 1.6vw, 1.05rem); line-height: 1.55; color: var(--ink-2); }
.wp-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 18px; }
.wp-tag { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 99px; font: inherit; font-size: .8rem; font-weight: 600; color: var(--ink-2); background: var(--glass-fill); border: 1px solid var(--glass-hairline); white-space: nowrap; }
button.wp-tag { cursor: pointer; }
button.wp-tag:hover:not(:disabled) { color: var(--ink-1); background: var(--glass-fill-strong); }
button.wp-tag:disabled { opacity: .6; cursor: default; }
.wp-note { font-size: .8rem; color: var(--ink-3); }
.wp-select { height: 32px; padding: 0 30px 0 12px; border-radius: 99px; font: inherit; font-size: .8rem; font-weight: 600; color: var(--ink-1); background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); cursor: pointer; appearance: none; -webkit-appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%); background-position: calc(100% - 15px) 52%, calc(100% - 10px) 52%; background-size: 5px 5px; background-repeat: no-repeat; }
.wp-select option { color: #0b1220; }
.wp-banner { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 4px 12px; padding: 14px 18px; margin-bottom: 14px; border-radius: 18px; font-size: .9rem; line-height: 1.45; color: var(--ink-2); }
.wp-banner b { color: var(--ink-1); }
.wp-banner .wp-pbar { grid-column: 1 / -1; margin-top: 6px; }
.wp-err { display: block; color: #f87171; }
.wp-pbar { height: 4px; border-radius: 99px; background: var(--glass-fill-strong); overflow: hidden; }
.wp-pbar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, ${ACCENTS[0]}, ${ACCENTS[1]}, ${ACCENTS[2]}); transition: width .6s ease; }
.wp-spin { animation: wp-spin 1s linear infinite; }
@keyframes wp-spin { to { transform: rotate(360deg); } }
.wp-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 56px 20px; text-align: center; color: var(--ink-2); }
.wp-empty b { color: var(--ink-1); font-size: 1.05rem; }
.wp-weeks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 6px; border-radius: 22px; max-width: 560px; }
.wp-weeks button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 10px 14px; border: 0; border-radius: 16px; cursor: pointer; font: inherit; text-align: left; color: var(--ink-2); background: none; transition: background .2s, color .2s; }
.wp-weeks button b { font-size: .95rem; font-weight: 650; }
.wp-weeks button span { font-size: .78rem; color: var(--ink-3); }
.wp-weeks button:hover { color: var(--ink-1); }
.wp-weeks button[aria-pressed='true'] { color: var(--ink-1); background: var(--glass-fill-strong); box-shadow: 0 1px 2px rgba(0,0,0,.12), inset 0 1px 0 var(--glass-highlight); }
.wp-weeks button[aria-pressed='true'] span { color: var(--ink-2); }
.wp-weekline { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px; margin: 18px 4px 12px; font-size: .84rem; color: var(--ink-3); }
.wp-weekline span:first-child { color: var(--ink-2); font-weight: 600; }
.wp-conf b { color: var(--ink-1); font-weight: 650; }
/* The cards share the grid's rows (subgrid), so a card's header, chips, map, day strip,
   description, facts and model support line up with its neighbours' however long each part is. */
.wp-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 1080px) { .wp-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 720px) { .wp-grid { grid-template-columns: minmax(0, 1fr); } }
.wp-card { display: grid; grid-row: span 7; grid-template-rows: subgrid; row-gap: 12px; align-content: start; padding: 16px; min-width: 0; overflow: hidden; isolation: isolate; }
.wp-card.wp-card-week { grid-row: span 6; }
@supports not (grid-template-rows: subgrid) { .wp-card { display: flex; flex-direction: column; gap: 12px; } .wp-support { margin-top: auto; } }
/* the scenario's colour: a rim along the top, clipped to the card's curve, and a faint wash under it */
.wp-card::before { content: ''; position: absolute; inset: 0 0 auto; height: 3px; background: var(--accent); }
.wp-card::after { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background: radial-gradient(120% 34% at 50% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 72%); }
.wp-reveal .wp-card { animation: wp-in .6s cubic-bezier(.22,1,.36,1) both; animation-delay: calc(var(--i) * 240ms); }
@keyframes wp-in { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .wp-reveal .wp-card { animation: none; } }
.wp-card-head { display: flex; align-items: center; gap: 12px; }
.wp-card-heading { min-width: 0; }
.wp-scn { display: block; font-size: .68rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }
.wp-card h3 { margin: 2px 0 0; font-size: clamp(1.15rem, 2vw, 1.35rem); font-weight: 700; letter-spacing: -.02em; line-height: 1.2; text-wrap: balance; }
.wp-ring { position: relative; flex: 0 0 56px; width: 56px; height: 56px; display: grid; place-items: center; }
.wp-ring svg { position: absolute; inset: 0; }
.wp-ring-track { fill: none; stroke: var(--glass-fill-strong); stroke-width: 5; }
.wp-ring-arc { transition: stroke-dasharray .8s cubic-bezier(.22,1,.36,1); }
.wp-ring b { position: relative; font-size: 1.05rem; font-weight: 750; letter-spacing: -.03em; }
.wp-ring b small { font-size: .62rem; font-weight: 700; margin-left: 1px; color: var(--ink-2); }
.wp-ring-wait { border-radius: 50%; border: 5px solid var(--glass-fill-strong); color: var(--ink-3); }
.wp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.wp-chip { padding: 4px 10px; border-radius: 99px; font-size: .74rem; font-weight: 650; color: var(--ink-1); background: color-mix(in srgb, var(--accent) 16%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 34%, transparent); }
.wp-map { position: relative; aspect-ratio: 560 / 500; border-radius: 16px; overflow: hidden; background: var(--wp-sea); border: 1px solid var(--glass-hairline); }
.wp-map-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.wp-sea { fill: var(--wp-sea); }
.wp-land { fill: var(--wp-land); stroke: var(--wp-coast); stroke-width: .8; stroke-linejoin: round; }
.wp-iso { animation: wp-fade .45s ease both; }
@keyframes wp-fade { from { opacity: 0; } to { opacity: 1; } }
.wp-iso path { fill: none; stroke: var(--wp-iso); stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
.wp-iso path.wp-iso-major { stroke: var(--wp-iso-major); stroke-width: 1.9; }
.wp-iso-label { font-size: 11px; font-weight: 650; fill: var(--ink-2); text-anchor: middle; dominant-baseline: central; paint-order: stroke; stroke: var(--wp-label-halo); stroke-width: 4px; stroke-linejoin: round; }
.wp-centre { font-size: 34px; font-weight: 800; text-anchor: middle; dominant-baseline: central; paint-order: stroke; stroke: var(--wp-label-halo); stroke-width: 3px; }
.wp-centre-p { font-size: 11px; font-weight: 700; text-anchor: middle; dominant-baseline: central; fill: var(--ink-2); paint-order: stroke; stroke: var(--wp-label-halo); stroke-width: 3px; }
.wp-high .wp-centre { fill: var(--wp-high); }
.wp-low .wp-centre { fill: var(--wp-low); }
.wp-map-top { position: absolute; inset: 10px 10px auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; pointer-events: none; }
.wp-map-day, .wp-play { pointer-events: auto; padding: 5px 10px; border-radius: 99px; font-size: .74rem; font-weight: 650; color: var(--ink-1); background: color-mix(in srgb, var(--page-bg) 62%, transparent); border: 1px solid var(--glass-hairline); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
.wp-play { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; cursor: pointer; }
.wp-map-wait { position: absolute; inset: 0; display: grid; place-items: center; color: var(--ink-3); }
.wp-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.wp-outlook { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 6px; margin-bottom: 12px; border-radius: 22px; }
@media (max-width: 720px) { .wp-outlook { grid-template-columns: minmax(0, 1fr); } }
.wp-outlook-week { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 12px 16px; border: 0; border-radius: 16px; cursor: pointer; font: inherit; text-align: left; color: var(--ink-1); background: var(--glass-fill); }
.wp-outlook-week:hover { background: var(--glass-fill-strong); }
.wp-outlook-when { font-size: .7rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
.wp-outlook-main { display: flex; align-items: center; gap: 8px; font-size: 1.15rem; font-weight: 700; letter-spacing: -.02em; }
.wp-outlook-main i { flex: 0 0 12px; height: 12px; border-radius: 4px; }
.wp-outlook-main b { font-size: .9rem; font-weight: 700; color: var(--ink-2); }
.wp-outlook-alt { font-size: .82rem; color: var(--ink-2); }
.wp-pchances { padding: 12px 14px; margin: 0 0 14px; border-radius: 18px; }
.wp-pchances-label { display: block; margin-bottom: 8px; font-size: .66rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
.wp-pbar2 { display: flex; gap: 2px; height: 10px; border-radius: 99px; overflow: hidden; }
.wp-pbar2 i { display: block; height: 100%; min-width: 3px; }
.wp-pkey { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 10px; font-size: .78rem; color: var(--ink-3); }
.wp-pkey span { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.wp-pkey span.wp-pkey-shown { color: var(--ink-1); font-weight: 650; }
.wp-pkey i { flex: 0 0 9px; height: 9px; border-radius: 3px; }
.wp-pkey b { font-weight: 700; font-variant-numeric: tabular-nums; }
.wp-day { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 7px 2px 6px; border-radius: 12px; cursor: pointer; font: inherit; color: var(--ink-1); background: var(--glass-fill); border: 1px solid transparent; transition: background .2s, border-color .2s; min-width: 0; }
.wp-day:hover { background: var(--glass-fill-strong); }
.wp-day[aria-selected='true'] { background: color-mix(in srgb, var(--sel) 18%, transparent); border-color: color-mix(in srgb, var(--sel) 55%, transparent); }
.wp-day-name { font-size: .7rem; font-weight: 700; color: var(--ink-2); }
.wp-day-t { display: flex; gap: 3px; align-items: baseline; font-size: .8rem; }
.wp-day-t b { font-weight: 700; }
.wp-day-t em { font-style: normal; font-size: .7rem; color: var(--ink-3); }
.wp-day-r { font-size: .64rem; font-weight: 600; color: var(--ink-3); white-space: nowrap; }
.wp-day-w { display: inline-flex; align-items: center; gap: 2px; min-height: 12px; font-size: .58rem; font-weight: 700; letter-spacing: .02em; color: var(--wp-gust); white-space: nowrap; }
.wp-desc { margin: 2px 2px 0; font-size: .92rem; line-height: 1.6; color: var(--ink-2); }
/* the facts measure their own width (a container on a wrapper: containment on the card itself would
   stop it being a subgrid) */
.wp-factbox { container: wpfacts / inline-size; min-width: 0; }
.wp-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; align-content: start; }
.wp-fact { display: flex; flex-direction: column; gap: 2px; padding: 9px 10px; border-radius: 14px; background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); min-width: 0; }
.wp-fact span { font-size: .6rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
.wp-fact b { font-size: 1rem; font-weight: 700; letter-spacing: -.01em; white-space: nowrap; }
.wp-fact em { font-style: normal; font-size: .72rem; line-height: 1.35; color: var(--ink-3); }
.wp-fact em.wp-up { color: #4f9bff; font-weight: 650; }
.wp-fact em.wp-down { color: #e0a44a; font-weight: 650; }
/* a narrow card (two columns on a tablet, or a phone): each fact becomes a row, its label at the side */
@container wpfacts (max-width: 360px) {
  .wp-facts { grid-template-columns: minmax(0, 1fr); gap: 5px; }
  .wp-facts .wp-fact { display: grid; grid-template-columns: 92px minmax(0, 1fr); column-gap: 10px; row-gap: 1px; align-items: baseline; padding: 8px 12px; }
  .wp-facts .wp-fact span { grid-row: span 3; align-self: center; }
  .wp-facts .wp-fact b, .wp-facts .wp-fact em { grid-column: 2; }
}
.wp-support p { margin: 6px 2px 0; font-size: .76rem; line-height: 1.45; color: var(--ink-3); }
.wp-mix-bar { display: flex; height: 6px; border-radius: 99px; overflow: hidden; background: var(--glass-fill-strong); }
.wp-mix-bar i { display: block; height: 100%; }
.wp-mix-key { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 14px; margin-top: 8px; font-size: .72rem; color: var(--ink-2); }
.wp-mix-key span { display: flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; }
.wp-mix-key i { flex: 0 0 8px; height: 8px; border-radius: 3px; }
.wp-mix-key b { margin-left: auto; font-weight: 650; color: var(--ink-1); font-variant-numeric: tabular-nums; }
.wp-mix-key .wp-mix-none { opacity: .5; }
.wp-pending { display: flex; flex-direction: column; gap: 12px; }
.wp-pending .wp-map { flex: 0 0 auto; }
.wp-shimmer, .wp-lines i { background: linear-gradient(100deg, var(--glass-fill) 30%, var(--glass-fill-strong) 50%, var(--glass-fill) 70%); background-size: 300% 100%; animation: wp-shine 1.6s ease-in-out infinite; }
@keyframes wp-shine { from { background-position: 100% 0; } to { background-position: 0 0; } }
.wp-lines { display: flex; flex-direction: column; gap: 8px; }
.wp-lines i { display: block; height: 10px; border-radius: 99px; }
.wp-lines i:nth-child(2) { width: 86%; } .wp-lines i:nth-child(3) { width: 64%; }
.wp-how { margin-top: 22px; padding: 4px; border-radius: 20px; }
.wp-how-head { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 14px; border: 0; background: none; cursor: pointer; font: inherit; color: var(--ink-1); text-align: left; }
.wp-how-head span { margin-left: auto; font-size: .8rem; color: var(--ink-3); }
.wp-how-body { padding: 0 16px 16px; font-size: .9rem; line-height: 1.6; color: var(--ink-2); }
.wp-how-body p { margin: 0 0 10px; max-width: 80ch; }
.wp-src { font-size: .78rem; color: var(--ink-3); }
.wp-weights { border-collapse: collapse; margin: 4px 0 14px; font-size: .84rem; }
.wp-weights th, .wp-weights td { padding: 6px 14px 6px 0; text-align: left; border-bottom: 1px solid var(--glass-hairline); }
.wp-weights th { font-size: .66rem; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
.wp-weights td:not(:first-child), .wp-weights th:not(:first-child) { text-align: right; color: var(--ink-1); font-variant-numeric: tabular-nums; }
`;
