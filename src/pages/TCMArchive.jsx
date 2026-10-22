/* TCM Archive: every TCM NOVA run once it is a day old (the TCM page shows the last 24 hours).

   The Main Run (2 km, four a day, four days ahead) and the Hyper-Short (1.5 km, hourly, 24 hours at
   30 minutes) are kept for good by server/tcmArchive, hazards only. Pick a day on the calendar (its
   colour is how the day-ahead Main Run saw it), then a run, then play it through, a frame at a time
   or a whole day at once, with the lightning that was recorded at the time on top.

   Open to everyone, while the TCM NOVA page itself stays admin-only. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Archive, CalendarDays, ChevronLeft, ChevronRight, Play, Pause, Zap, Layers, Loader2, Clock, CloudLightning } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import VfPage, { Stat } from '@/components/verification/VfPage';
import VfMap from '@/components/verification/VfMap';
import {
  archiveJson, fetchField, renderField, valueAt, FIELDS, LEVELS, levelOf, levelColour, valueText, fetchStrikes,
  london, hhmm, dayShort, dayLong,
} from '@/components/verification/novaMaps';

const PRODUCTS = {
  main: { label: 'Main Run', blurb: '2 km · four a day · four days ahead' },
  hyper: { label: 'Hyper-Short', blurb: '1.5 km · every hour · 24 hours at 30 min' },
};
const TOP_LAYERS = ['p_thunder', 'p_lightning', 'p_hail', 'p_wind_damaging', 'p_tornado_env', 'p_heavy_rain', 'p_severe'];
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const CSS = `
.ar-grid { display: grid; grid-template-columns: minmax(300px, 370px) minmax(0, 1fr); gap: 16px; align-items: start; }
.ar-side { display: flex; flex-direction: column; gap: 16px; position: sticky; top: 76px; }
.ar-cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.ar-cal > small { text-align: center; font-size: 10.5px; font-weight: 750; color: var(--ad-text-faint); padding-bottom: 4px; }
.ar-day { position: relative; aspect-ratio: 1 / 1.05; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; padding: 0; border-radius: 11px;
  font: inherit; font-size: 13px; font-weight: 700; color: var(--ad-text); background: var(--ad-surface3); border: 1px solid var(--ad-border); cursor: pointer; transition: border-color .15s, background .15s; }
.ar-day:disabled { cursor: default; color: var(--ad-text-faint); background: transparent; border-color: transparent; font-weight: 500; }
.ar-day:not(:disabled):hover { border-color: var(--ad-border3); }
.ar-day.on { border-color: var(--c); box-shadow: 0 0 0 1px var(--c); background: color-mix(in srgb, var(--c) 12%, var(--ad-surface2)); }
.ar-day i { width: 60%; height: 4px; border-radius: 3px; background: var(--k, transparent); }
.ar-day em { font-style: normal; font-size: 9.5px; font-weight: 650; color: var(--ad-text-dim); }
.ar-month { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.ar-month b { flex: 1; text-align: center; font-size: 14px; }
.ar-runs { display: flex; flex-direction: column; gap: 6px; max-height: 420px; overflow-y: auto; }
.ar-run { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 11px; border-radius: 13px; font: inherit; text-align: left; cursor: pointer;
  color: var(--ad-text); background: var(--ad-surface3); border: 1px solid var(--ad-border); }
.ar-run:hover { border-color: var(--ad-border3); }
.ar-run.on { border-color: color-mix(in srgb, var(--c) 60%, transparent); background: color-mix(in srgb, var(--c) 12%, var(--ad-surface2)); }
.ar-run b { font-size: 14px; font-variant-numeric: tabular-nums; }
.ar-run small { display: block; font-size: 11.5px; color: var(--ad-text-dim); }
.ar-run .vf-chip { margin-left: auto; }
.ar-tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px 18px; border-bottom: 1px solid var(--ad-border); }
.ar-mapbox { position: relative; padding: 12px; }
.ar-mapbox .vf-read { left: 24px; bottom: 24px; }
.ar-mapbox .vf-busy { right: 24px; top: 24px; }
.ar-time { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 4px 18px 14px; }
.ar-time input[type=range] { flex: 1; min-width: 160px; accent-color: var(--c); }
.ar-when { min-width: 170px; }
.ar-when b { display: block; font-size: 15px; font-variant-numeric: tabular-nums; }
.ar-when small { font-size: 11.5px; color: var(--ad-text-dim); }
.ar-days { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 18px 12px; }
.ar-peaks { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 18px 16px; }
.ar-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; padding: 0 18px 18px; }
@media (max-width: 1100px) { .ar-grid { grid-template-columns: minmax(0, 1fr); } .ar-side { position: static; } .ar-runs { max-height: 260px; } }
@media (max-width: 640px) { .ar-tools, .ar-time, .ar-days, .ar-peaks, .ar-meta { padding-left: 12px; padding-right: 12px; } .ar-mapbox { padding: 8px; } }
`;

const monthName = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const pct = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`);

/** The days of `month` laid out Monday-first, with blanks before the 1st. */
function monthCells(month) {
  const first = new Date(`${month}-01T12:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
}

function Calendar({ cal, month, setMonth, date, setDate }) {
  const byDate = useMemo(() => new Map((cal?.days || []).map((d) => [d.date, d])), [cal]);
  const months = cal?.months || [];
  const older = months.find((m) => m < month), newer = [...months].reverse().find((m) => m > month);
  return (
    <section className="vf-glass vf-card">
      <div className="vf-head"><CalendarDays /><h2>Pick a day</h2></div>
      <div className="vf-body">
        <div className="ar-month">
          <button type="button" className="vf-btn is-icon" disabled={!older} onClick={() => setMonth(older)} aria-label="Earlier month"><ChevronLeft /></button>
          <b>{monthName(month)}</b>
          <button type="button" className="vf-btn is-icon" disabled={!newer} onClick={() => setMonth(newer)} aria-label="Later month"><ChevronRight /></button>
        </div>
        <div className="ar-cal">
          {WEEK.map((w) => <small key={w}>{w}</small>)}
          {monthCells(month).map((d, i) => {
            if (!d) return <span key={`b${i}`} />;
            const x = byDate.get(d);
            const L = x?.outlook ? levelOf(x.outlook.p_thunder ?? 0) : null;
            return (
              <button key={d} type="button" disabled={!x} className={`ar-day${d === date ? ' on' : ''}`} onClick={() => setDate(d)}
                style={{ '--k': L ? levelColour(L) : 'transparent' }}
                title={x ? `${dayLong(d)}: ${x.main} Main Run${x.main === 1 ? '' : 's'}, ${x.hyper} Hyper-Short${x.outlook ? ` · day-ahead peak ${pct(x.outlook.p_thunder)} (${L ? L.key : 'below TSTM'})` : ''}` : undefined}>
                {Number(d.slice(8))}
                <i />
                {x && <em>{x.main}·{x.hyper}</em>}
              </button>
            );
          })}
        </div>
        <div className="vf-legend" style={{ marginTop: 12 }}>
          {LEVELS.map((L) => <span key={L.key}><i style={{ background: levelColour(L) }} />{L.key}</span>)}
        </div>
        <p className="vf-note" style={{ margin: '10px 0 0' }}>The bar under a day is the thunderstorm risk the Main Run gave it the evening before. The small numbers are the Main Runs · Hyper-Short runs made that day.</p>
      </div>
    </section>
  );
}

function RunList({ product, setProduct, date, runs, runId, setRunId }) {
  return (
    <section className="vf-glass vf-card">
      <div className="vf-head"><Clock /><h2>{date ? dayShort(date) : 'Runs'}</h2><span className="vf-sp" />
        <div className="vf-seg" role="tablist">
          {Object.entries(PRODUCTS).map(([id, p]) => <button key={id} type="button" role="tab" aria-selected={product === id} className={product === id ? 'on' : ''} onClick={() => setProduct(id)}>{p.label}</button>)}
        </div>
      </div>
      <div className="vf-body">
        {!date && <p className="vf-note" style={{ margin: 0 }}>Pick a day on the calendar.</p>}
        {date && runs === null && <div className="vf-skel" style={{ height: 120 }} />}
        {date && runs?.length === 0 && <p className="vf-note" style={{ margin: 0 }}>No {PRODUCTS[product].label} from {dayShort(date)} in the archive.</p>}
        {date && runs?.length > 0 && (
          <div className="ar-runs">
            {runs.map((r) => {
              const L = levelOf(r.peak.p_thunder);
              return (
                <button key={r.run_id} type="button" className={`ar-run${r.run_id === runId ? ' on' : ''}`} onClick={() => setRunId(r.run_id)}>
                  <span><b>{hhmm(r.init_utc)}</b><small>{r.frames} frames · to T+{r.horizon_h}{r.status === 'degraded' ? ' · degraded' : ''}</small></span>
                  <span className="vf-chip" style={{ '--k': L ? levelColour(L) : undefined }} title="Peak thunderstorm probability in the run">{L ? L.key : 'none'} · {pct(r.peak.p_thunder)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Viewer({ product, manifest, dark }) {
  const [idx, setIdx] = useState(0);
  const [dayView, setDayView] = useState(null);
  const [layer, setLayer] = useState('p_thunder');
  const [levels, setLevels] = useState(true);
  const [showStrikes, setShowStrikes] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [strikes, setStrikes] = useState(null);
  const [hover, setHover] = useState(null);
  const id = manifest.run_id;
  const fields = useMemo(() => Object.keys(FIELDS).filter((f) => manifest.fields[f]), [manifest]);
  useEffect(() => { if (!fields.includes(layer)) setLayer(fields[0] || 'p_thunder'); }, [fields, layer]);
  const frame = manifest.frames[Math.min(idx, manifest.frames.length - 1)];
  const day = dayView ? manifest.days.find((d) => d.date === dayView) : null;
  const useDay = !!(day && day.fields.includes(layer));
  const stepMin = product === 'main' ? (manifest.step_h || 3) * 60 : (manifest.step_min || 30);
  const url = (f, lead) => `/api/tcm-archive/${product}/runs/${id}/frame/${lead}/${f}`;

  /* the field on show */
  useEffect(() => {
    let alive = true;
    setBusy(true); setErr(null);
    const src = useDay ? `/api/tcm-archive/${product}/runs/${id}/day/${dayView}/${layer}` : url(layer, frame.lead_min);
    fetchField(src).then((d) => { if (alive) { setData(d); setBusy(false); } }).catch((e) => { if (alive) { setErr(e.message); setBusy(false); } });
    /* the next frame, ready for playing */
    if (!useDay) { const nx = manifest.frames[idx + 1]; if (nx) fetchField(url(layer, nx.lead_min)).catch(() => {}); }
    return () => { alive = false; };
  }, [product, id, layer, frame.lead_min, useDay, dayView]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the lightning recorded at the time: the whole day, or the frame's own step around its time */
  useEffect(() => {
    if (!showStrikes) { setStrikes(null); return undefined; }
    let alive = true;
    const t = Date.parse(frame.valid);
    const q = dayView ? fetchStrikes(dayView) : fetchStrikes(t - (stepMin / 2) * 60e3, t + (stepMin / 2) * 60e3);
    q.then((s) => { if (alive) setStrikes(s); }).catch(() => { if (alive) setStrikes({ strikes: [], total: 0 }); });
    return () => { alive = false; };
  }, [showStrikes, dayView, frame.valid, stepMin]);

  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => setIdx((i) => (i + 1 >= manifest.frames.length ? 0 : i + 1)), 1100);
    return () => clearInterval(t);
  }, [playing, manifest.frames.length]);

  const F = FIELDS[layer];
  const asLevels = levels && F.risk;
  const canvas = useMemo(() => (data ? renderField(data, manifest.grid, F, { levels: asLevels }) : null), [data, manifest.grid, F, asLevels]);
  const read = hover && data ? valueAt(data, manifest.grid, hover[0], hover[1]) : null;
  const stats = useDay ? day.stats : frame.stats;

  return (
    <section className="vf-glass vf-card">
      <div className="vf-head"><CloudLightning />
        <h2>{PRODUCTS[product].label} · {london(manifest.init_utc, { weekday: 'short', day: 'numeric', month: 'short' })} {hhmm(manifest.init_utc)}</h2>
        <small>{PRODUCTS[product].blurb}</small>
      </div>
      <div className="ar-tools">
        {TOP_LAYERS.filter((f) => fields.includes(f)).map((f) => (
          <button key={f} type="button" className={`vf-btn${layer === f ? ' is-on' : ''}`} onClick={() => setLayer(f)}>{FIELDS[f].label}</button>
        ))}
        <select className="vf-input" style={{ width: 'auto', padding: '7px 10px', fontSize: 13 }} value={TOP_LAYERS.includes(layer) ? '' : layer} onChange={(e) => e.target.value && setLayer(e.target.value)} aria-label="More layers">
          <option value="">More…</option>
          {fields.filter((f) => !TOP_LAYERS.includes(f)).map((f) => <option key={f} value={f}>{FIELDS[f].long}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        {F.risk && (
          <div className="vf-seg">
            <button type="button" className={levels ? 'on' : ''} onClick={() => setLevels(true)}>Risk levels</button>
            <button type="button" className={!levels ? 'on' : ''} onClick={() => setLevels(false)}>Shades</button>
          </div>
        )}
        <button type="button" className={`vf-btn${showStrikes ? ' is-on' : ''}`} style={{ '--c': '#facc15' }} onClick={() => setShowStrikes((v) => !v)} aria-pressed={showStrikes}>
          <Zap />Strikes{showStrikes && strikes ? ` · ${strikes.total.toLocaleString()}` : ''}
        </button>
      </div>
      <div className="ar-mapbox">
        <VfMap dark={dark} overlay={canvas} strikes={showStrikes ? strikes?.strikes : null} onHover={(la, lo) => setHover(la == null ? null : [la, lo])} height="min(68vh, 680px)" />
        {hover && read != null && <div className="vf-read">{F.long}: <b>{valueText(read, F)}</b></div>}
        {busy && <div className="vf-busy"><Loader2 className="vf-spin" />Loading</div>}
        {err && !busy && <div className="vf-busy" style={{ color: 'var(--ad-red)' }}>Not in this run</div>}
      </div>
      {product === 'main' && manifest.days?.length > 0 && (
        <div className="ar-days">
          <button type="button" className={`vf-btn${!dayView ? ' is-on' : ''}`} onClick={() => setDayView(null)}><Clock />Frame by frame</button>
          {manifest.days.map((d) => (
            <button key={d.date} type="button" className={`vf-btn${dayView === d.date ? ' is-on' : ''}`} onClick={() => { setDayView(d.date); setPlaying(false); }}
              title={d.complete === false ? 'Only part of this day is in the run' : 'All of this day’s frames combined'}>
              {dayShort(d.date)}{d.complete === false ? ' (part)' : ''}
            </button>
          ))}
        </div>
      )}
      {!dayView && (
        <div className="ar-time">
          <button type="button" className="vf-btn is-icon" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause /> : <Play />}</button>
          <button type="button" className="vf-btn is-icon" onClick={() => { setPlaying(false); setIdx((i) => Math.max(0, i - 1)); }} aria-label="Previous frame"><ChevronLeft /></button>
          <button type="button" className="vf-btn is-icon" onClick={() => { setPlaying(false); setIdx((i) => Math.min(manifest.frames.length - 1, i + 1)); }} aria-label="Next frame"><ChevronRight /></button>
          <div className="ar-when"><b>{london(frame.valid, { weekday: 'short', day: 'numeric', month: 'short' })} {hhmm(frame.valid)}</b><small>T+{Math.floor(frame.lead_min / 60)}{frame.lead_min % 60 ? `:${String(frame.lead_min % 60).padStart(2, '0')}` : ''} h · frame {idx + 1} of {manifest.frames.length}</small></div>
          <input type="range" min={0} max={manifest.frames.length - 1} value={idx} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} aria-label="Frame" />
        </div>
      )}
      {dayView && <div className="ar-time"><div className="ar-when"><b>{dayLong(dayView)}</b><small>{useDay ? 'The day’s frames combined: the highest value each place reached' : `This layer has no whole-day map; showing ${hhmm(frame.valid)}`}</small></div></div>}
      <div className="ar-peaks">
        {['p_thunder', 'p_lightning', 'p_hail', 'p_wind_damaging', 'p_tornado_env', 'p_heavy_rain'].filter((f) => stats?.[f]).map((f) => {
          const v = stats[f].max, L = levelOf(v);
          return <span key={f} className="vf-chip" style={{ '--k': L ? levelColour(L) : undefined }}>{FIELDS[f].label} {pct(v)}</span>;
        })}
      </div>
      <div className="ar-meta">
        <Stat label="Made" value={hhmm(manifest.init_utc)} note={london(manifest.init_utc, { weekday: 'long', day: 'numeric', month: 'long' })} />
        <Stat label="Reaches" value={`T+${manifest.horizon_h} h`} note={`${manifest.frames.length} frames`} />
        <Stat label="Grid" value={`${(manifest.resolution_m || manifest.grid.dx_m) / 1000} km`} note={manifest.grid.name} />
        <Stat label="Engine" value={manifest.engine_version || '—'} note={manifest.status === 'degraded' ? 'published degraded' : 'published'} />
      </div>
      <div className="vf-body" style={{ paddingTop: 0 }}>
        <div className="vf-legend">
          {asLevels ? LEVELS.map((L) => <span key={L.key}><i style={{ background: levelColour(L, 0.75) }} />{L.key} {Math.round(L.p * 100)}%+</span>)
            : <span>{F.long}{F.unit ? ` (${F.unit})` : ''}: {F.stops.slice(1).map((s) => <span key={s[0]} style={{ marginLeft: 8 }}><i style={{ background: `rgba(${s[1].slice(0, 3).join(',')},.85)` }} />{F.pct ? `${Math.round(s[0] * 100)}%` : s[0]}</span>)}</span>}
          {showStrikes && <span><i style={{ background: 'linear-gradient(90deg,#dc2626,#f97316,#facc15,#fffbe6)' }} />strikes, earliest to latest</span>}
        </div>
      </div>
    </section>
  );
}

export default function TCMArchive() {
  const { isDark } = useTheme();
  const [params, setParams] = useSearchParams();
  const product = params.get('product') === 'hyper' ? 'hyper' : 'main';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : null;
  const runId = params.get('run') || null;
  const set = (patch) => setParams((p) => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(patch)) { if (v == null) n.delete(k); else n.set(k, v); } return n; }, { replace: true });

  const [status, setStatus] = useState(null);
  const [month, setMonth] = useState(date ? date.slice(0, 7) : null);
  const [cal, setCal] = useState(null);
  const [runs, setRuns] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [err, setErr] = useState(null);
  const first = useRef(true);

  useEffect(() => {
    archiveJson('/api/tcm-archive/status').then(setStatus).catch(() => setErr('The archive could not be reached.'));
  }, []);

  /* the month on show; with nothing chosen, the newest month in the archive */
  useEffect(() => {
    let alive = true;
    archiveJson(`/api/tcm-archive/calendar${month ? `?month=${month}` : ''}`).then((c) => {
      if (!alive) return;
      if (!month && c.months.length && !c.days.length) { setMonth(c.months[0]); return; }
      setCal(c);
      if (!month) setMonth(c.month);
      /* open on the newest day the first time */
      if (first.current && !date && c.days.length) { first.current = false; set({ date: c.days[c.days.length - 1].date }); }
    }).catch(() => {});
    return () => { alive = false; };
  }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the day's runs; the newest opens unless one is named */
  useEffect(() => {
    if (!date) { setRuns(null); return undefined; }
    let alive = true;
    setRuns(null);
    archiveJson(`/api/tcm-archive/${product}/runs?date=${date}`).then((r) => {
      if (!alive) return;
      setRuns(r.runs);
      if (!r.runs.some((x) => x.run_id === runId)) set({ run: r.runs[0]?.run_id || null });
    }).catch(() => { if (alive) setRuns([]); });
    return () => { alive = false; };
  }, [date, product]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!runId || !runId.startsWith(`${product}-`)) { setManifest(null); return undefined; }
    let alive = true;
    archiveJson(`/api/tcm-archive/${product}/runs/${runId}`).then((m) => { if (alive) setManifest(m); }).catch(() => { if (alive) setManifest(null); });
    return () => { alive = false; };
  }, [runId, product]);

  const hero = status && (
    <div className="vf-stats">
      <Stat label="Main Runs" value={status.main.runs.toLocaleString()} note={status.main.oldest ? `since ${london(status.main.oldest, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'none yet'} />
      <Stat label="Hyper-Short runs" value={status.hyper.runs.toLocaleString()} note={status.hyper.oldest ? `since ${london(status.hyper.oldest, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'none yet'} />
      <Stat label="Joins the archive" value={`${status.age_h} h old`} note="newer runs are on the TCM page" />
    </div>
  );

  return (
    <VfPage title="TCM Archive" accent="#38bdf8" accent2="#a78bfa" css={CSS} hero={hero}
      lede="Every TCM NOVA run once it is a day old: the Main Run and the Hyper-Short, kept for good. Pick a day, pick a run, and play it through with the lightning that was recorded at the time.">
      {err && <div className="vf-error">{err}</div>}
      {!err && status && status.main.runs + status.hyper.runs === 0 && (
        <section className="vf-glass vf-card"><div className="vf-empty"><Archive /><b>The archive is filling up</b><p>Runs arrive here once they are a day old. Check back tomorrow.</p></div></section>
      )}
      {!err && month && (cal?.days.length > 0) && (
        <div className="ar-grid">
          <aside className="ar-side">
            <Calendar cal={cal} month={month} setMonth={(m) => setMonth(m)} date={date} setDate={(d) => set({ date: d, run: null })} />
            <RunList product={product} setProduct={(p) => set({ product: p, run: null })} date={date} runs={runs} runId={runId} setRunId={(r) => set({ run: r })} />
          </aside>
          {manifest ? <Viewer key={`${product}-${manifest.run_id}`} product={product} manifest={manifest} dark={isDark} />
            : (
              <section className="vf-glass vf-card">
                <div className="vf-empty"><Layers /><b>{date ? (runs?.length === 0 ? 'No run to show' : 'Opening the run…') : 'Pick a day'}</b>
                  <p>{date ? `Choose a ${PRODUCTS[product].label} from ${dayShort(date)}, or switch to the ${product === 'main' ? 'Hyper-Short' : 'Main Run'}.` : 'Days with runs are lit on the calendar.'}</p>
                </div>
              </section>
            )}
        </div>
      )}
    </VfPage>
  );
}
