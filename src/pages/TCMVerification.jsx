/* TCM Verification: each finished day, the TCM NOVA Main Run's lightning risk for the whole day
   (its frames combined: the highest probability each place reached) with the lightning the Met
   Office recorded that day on top.

   The forecast is the run made the evening before (the first run of the day where there is none);
   any other Main Run that covered the day can be picked instead. server/tcmArchive/verify.js works
   out, per risk level, the area it covered, the strikes that fell inside it and how much of it saw
   lightning within 10 km. Open to everyone, while the TCM NOVA page itself stays admin-only. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Target, Zap, ChevronLeft, ChevronRight, Loader2, CloudLightning, Info } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import VfPage, { Stat } from '@/components/verification/VfPage';
import VfMap, { strikeColour } from '@/components/verification/VfMap';
import { loadLand, mercator, traceRings } from '@/components/verification/landOutline';
import {
  archiveJson, fetchField, renderField, valueAt, FIELDS, LEVELS, levelOf, levelColour, fetchStrikes,
  london, hhmm, dayShort, dayLong, MAP_BOUNDS,
} from '@/components/verification/novaMaps';

const F = FIELDS.p_lightning;
const BOX = { west: MAP_BOUNDS[0][1], east: MAP_BOUNDS[1][1], north: MAP_BOUNDS[1][0], south: MAP_BOUNDS[0][0] };
const TW = 228, TH = 300;

const CSS = `
.tv-detail { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(320px, 1fr); gap: 16px; padding: 14px; }
.tv-side { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.tv-table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.tv-table th { text-align: left; font-size: 10.5px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; color: var(--ad-text-dim); padding: 0 8px 8px; }
.tv-table td { padding: 8px; border-top: 1px solid var(--ad-border); white-space: nowrap; }
.tv-table td:first-child { padding-left: 0; } .tv-table th:first-child { padding-left: 0; }
.tv-table td small { color: var(--ad-text-dim); margin-left: 4px; }
.tv-bar { position: relative; height: 6px; border-radius: 4px; background: var(--ad-surface3); overflow: hidden; margin-top: 4px; min-width: 70px; }
.tv-bar i { position: absolute; inset: 0 auto 0 0; border-radius: 4px; background: var(--k); }
.tv-sum { padding: 13px 15px; border-radius: 16px; background: var(--ad-surface3); border: 1px solid var(--ad-border); font-size: 13.5px; line-height: 1.55; }
.tv-sum b { color: var(--ad-text); }
.tv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; padding: 14px; }
.tv-card { display: flex; flex-direction: column; padding: 0; border-radius: 18px; overflow: hidden; cursor: pointer; font: inherit; text-align: left; color: var(--ad-text);
  background: var(--ad-surface3); border: 1px solid var(--ad-border); transition: border-color .15s, transform .15s, box-shadow .15s; }
.tv-card:hover { transform: translateY(-1px); border-color: var(--ad-border3); }
.tv-card.on { border-color: var(--c); box-shadow: 0 0 0 1px var(--c); }
.tv-card canvas { display: block; width: 100%; height: auto; aspect-ratio: ${TW} / ${TH}; background: var(--ad-surface3); }
.tv-card > div { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 6px; }
.tv-card b { font-size: 14px; }
.tv-card small { font-size: 12px; color: var(--ad-text-dim); }
.tv-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tv-split { display: flex; height: 6px; border-radius: 4px; overflow: hidden; background: var(--ad-surface2); }
.tv-split i { display: block; height: 100%; }
@media (max-width: 1050px) { .tv-detail { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 640px) { .tv-detail, .tv-grid { padding: 8px; } .tv-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } .tv-card > div { padding: 8px 9px 10px; } }
`;

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const km2 = (a) => (a >= 1e4 ? `${Math.round(a / 1000).toLocaleString()}k km²` : `${a.toLocaleString()} km²`);
const runName = (c) => `${london(c.init_utc, { weekday: 'short', day: 'numeric', month: 'short' })} ${hhmm(c.init_utc)}`;

/** What the day's numbers say, in a sentence or two. */
function summary(v) {
  const n = v.strikes.on_grid, ts = v.levels[0], mr = v.levels[1];
  if (!v.strikes.data) return <>There is no lightning record for this day, so it cannot be checked.</>;
  if (!n) {
    return ts.area_km2
      ? <>No lightning was recorded on the map. The outlook had <b>{km2(ts.area_km2)}</b> at General thunder or above{mr.area_km2 ? <>, <b>{km2(mr.area_km2)}</b> of it Marginal or higher</> : null}: a false alarm.</>
      : <>No lightning was recorded and the outlook had no risk area: a quiet day called right.</>;
  }
  return (
    <>
      <b>{mr.strikes.toLocaleString()}</b> of the <b>{n.toLocaleString()}</b> strikes ({pct(mr.strikes_frac)}) fell inside the Marginal-or-higher area,
      and <b>{ts.strikes.toLocaleString()}</b> ({pct(ts.strikes_frac)}) inside any risk area.
      {mr.area_km2 ? <> Lightning came within {v.near_km} km of <b>{pct(mr.lit_frac)}</b> of the Marginal area.</> : <> The outlook had no Marginal area.</>}
    </>
  );
}

/* a day's small map: land, the combined risk in levels, the strikes */
function Thumb({ v, dark }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!seen || !v.run) return undefined;
    let alive = true;
    Promise.all([
      loadLand(),
      fetchField(`/api/tcm-archive/main/runs/${v.run.run_id}/day/${v.date}/p_lightning`),
      v.strikes.on_grid ? fetchStrikes(v.date) : Promise.resolve({ strikes: [] }),
    ]).then(([land, data, s]) => {
      if (!alive || !ref.current) return;
      const cv = ref.current, ctx = cv.getContext('2d');
      const P = mercator(BOX, TW, TH);
      ctx.fillStyle = dark ? '#0c1524' : '#dde7f2';
      ctx.fillRect(0, 0, TW, TH);
      ctx.fillStyle = dark ? '#1b2637' : '#ffffff';
      traceRings(ctx, land.context, P, 0.8); ctx.fill();
      traceRings(ctx, land.counties, P, 0.8); ctx.fill();
      ctx.drawImage(renderField(data, v.run.grid, F, { w: TW, h: TH, levels: true }), 0, 0);
      ctx.strokeStyle = dark ? 'rgba(226,232,240,.35)' : 'rgba(15,23,42,.3)';
      ctx.lineWidth = 0.5;
      traceRings(ctx, land.counties, P, 0.8); ctx.stroke();
      const st = s.strikes, t0 = st[0]?.[0], span = Math.max((st.at(-1)?.[0] ?? 0) - t0, 1);
      for (const [t, la, lo] of st) {
        const [x, y] = P(lo, la);
        ctx.fillStyle = strikeColour((t - t0) / span);
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [seen, v, dark]);
  return <canvas ref={ref} width={TW} height={TH} aria-hidden="true" />;
}

function DayCard({ v, on, onPick, dark }) {
  if (v.pending) {
    return <div className="tv-card"><div className="vf-skel" style={{ aspectRatio: `${TW} / ${TH}`, borderRadius: 0 }} /><div><b>{dayShort(v.date)}</b><small>Being worked out…</small></div></div>;
  }
  const L = levelOf(v.peak.p), n = v.strikes.on_grid;
  const mr = v.levels[1].strikes, ts = v.levels[0].strikes;
  return (
    <button type="button" className={`tv-card${on ? ' on' : ''}`} onClick={onPick}>
      <Thumb v={v} dark={dark} />
      <div>
        <div className="tv-row"><b>{dayShort(v.date)}</b><span style={{ flex: 1 }} /><span className="vf-chip" style={{ '--k': L ? levelColour(L) : undefined }}>{L ? L.key : 'No risk'}</span></div>
        <small><Zap style={{ width: 12, height: 12, verticalAlign: -2, color: '#facc15' }} /> {v.strikes.data ? `${n.toLocaleString()} strike${n === 1 ? '' : 's'}` : 'no lightning record'}{n ? ` · ${pct(v.levels[1].strikes_frac)} inside Marginal+` : ''}</small>
        {n > 0 && (
          <div className="tv-split" title="Strikes inside Marginal or higher · inside General thunder only · outside the outlook">
            <i style={{ width: `${(mr / n) * 100}%`, background: levelColour(LEVELS[1]) }} />
            <i style={{ width: `${((ts - mr) / n) * 100}%`, background: levelColour(LEVELS[0]) }} />
          </div>
        )}
      </div>
    </button>
  );
}

function DayDetail({ date, run, setRun, dark, prev, next, go }) {
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  const [data, setData] = useState(null);
  const [strikes, setStrikes] = useState(null);
  const [show, setShow] = useState(true);
  const [levels, setLevels] = useState(true);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    let alive = true;
    setV(null); setErr(null); setData(null);
    archiveJson(`/api/tcm-archive/verification/${date}${run ? `?run=${run}` : ''}`).then((x) => { if (alive) setV(x); }).catch(() => { if (alive) setErr('This day could not be loaded.'); });
    return () => { alive = false; };
  }, [date, run]);
  useEffect(() => {
    if (!v) return undefined;
    let alive = true;
    fetchField(`/api/tcm-archive/main/runs/${v.run.run_id}/day/${date}/p_lightning`)
      .then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setErr('The forecast map could not be loaded.'); });
    return () => { alive = false; };
  }, [v, date]);
  useEffect(() => {
    let alive = true;
    setStrikes(null);
    fetchStrikes(date).then((s) => { if (alive) setStrikes(s.strikes); }).catch(() => { if (alive) setStrikes([]); });
    return () => { alive = false; };
  }, [date]);

  const grid = v?.run.grid;
  const canvas = useMemo(() => (data && grid ? renderField(data, grid, F, { levels }) : null), [data, grid, levels]);
  const read = hover && data && grid ? valueAt(data, grid, hover[0], hover[1]) : null;
  const L = v ? levelOf(v.peak.p) : null;

  return (
    <section className="vf-glass vf-card">
      <div className="vf-head"><CloudLightning />
        <h2>{dayLong(date)}</h2>
        {L && <span className="vf-chip" style={{ '--k': levelColour(L) }}>Peak {L.key} · {pct(v.peak.p)}</span>}
        <span className="vf-sp" />
        <button type="button" className="vf-btn is-icon" disabled={!prev} onClick={() => go(prev)} aria-label="Day before"><ChevronLeft /></button>
        <button type="button" className="vf-btn is-icon" disabled={!next} onClick={() => go(next)} aria-label="Day after"><ChevronRight /></button>
      </div>
      {err && <div className="vf-body"><div className="vf-error">{err}</div></div>}
      {!err && (
        <div className="tv-detail">
          <div style={{ position: 'relative', minWidth: 0 }}>
            <VfMap dark={dark} overlay={canvas} strikes={show ? strikes : null} onHover={(la, lo) => setHover(la == null ? null : [la, lo])} height="min(70vh, 660px)" />
            {hover && read != null && <div className="vf-read">Lightning chance: <b>{pct(read)}</b>{levelOf(read) ? ` · ${levelOf(read).key}` : ''}</div>}
            {(!canvas || strikes === null) && <div className="vf-busy"><Loader2 className="vf-spin" />Loading</div>}
          </div>
          <div className="tv-side">
            <div>
              <label className="vf-label" htmlFor="tv-run">Forecast from the Main Run made</label>
              <select id="tv-run" className="vf-input" value={v?.run.run_id || ''} onChange={(e) => setRun(e.target.value === v?.default_run ? null : e.target.value)} disabled={!v}>
                {(v?.choices || []).map((c) => (
                  <option key={c.run_id} value={c.run_id}>{runName(c)}{c.run_id === v.default_run ? ' · the day before (default)' : ''}{c.complete ? '' : ' · part of the day'}</option>
                ))}
              </select>
            </div>
            <div className="tv-row">
              <div className="vf-seg">
                <button type="button" className={levels ? 'on' : ''} onClick={() => setLevels(true)}>Risk levels</button>
                <button type="button" className={!levels ? 'on' : ''} onClick={() => setLevels(false)}>Shades</button>
              </div>
              <button type="button" className={`vf-btn${show ? ' is-on' : ''}`} style={{ '--c': '#facc15' }} onClick={() => setShow((s) => !s)} aria-pressed={show}><Zap />Strikes{strikes ? ` · ${strikes.length.toLocaleString()}` : ''}</button>
            </div>
            {!v && <div className="vf-skel" style={{ height: 240 }} />}
            {v && (
              <>
                <div className="vf-stats" style={{ marginTop: 0, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  <Stat label="In the forecast area" value={v.strikes.data ? v.strikes.on_grid.toLocaleString() : '—'} note={v.strikes.total !== v.strikes.on_grid ? `strikes; ${v.strikes.total.toLocaleString()} recorded in all` : `strikes · ${v.strikes.source}`} />
                  <Stat label="Inside Marginal+" value={pct(v.levels[1].strikes_frac)} note={`${v.levels[1].strikes.toLocaleString()} strikes`} />
                </div>
                <div className="tv-sum">{summary(v)}</div>
                <table className="tv-table">
                  <thead><tr><th>Level</th><th>Area</th><th>Strikes inside</th><th>Saw lightning</th></tr></thead>
                  <tbody>
                    {v.levels.map((x) => {
                      const Lx = LEVELS.find((y) => y.key === x.key);
                      return (
                        <tr key={x.key}>
                          <td><span className="vf-chip" style={{ '--k': levelColour(Lx) }}>{x.key}</span></td>
                          <td>{x.area_km2 ? km2(x.area_km2) : '—'}</td>
                          <td>{x.strikes.toLocaleString()}<small>{pct(x.strikes_frac)}</small><div className="tv-bar" style={{ '--k': levelColour(Lx) }}><i style={{ width: `${(x.strikes_frac || 0) * 100}%` }} /></div></td>
                          <td>{x.area_km2 ? pct(x.lit_frac) : '—'}<div className="tv-bar" style={{ '--k': levelColour(Lx) }}><i style={{ width: `${(x.lit_frac || 0) * 100}%` }} /></div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="vf-note" style={{ margin: 0 }}>
                  <Info style={{ width: 13, height: 13, verticalAlign: -2 }} /> The map is the lightning chance from the run made {runName(v.run)}, {v.same_day ? 'on the day itself' : `${v.run.lead_h} hours before the day began`},
                  with the day’s 3-hourly frames combined: each place shows the highest chance it reached. <b>Strikes inside</b> is how much of the day’s lightning each level caught;
                  <b> saw lightning</b> is how much of the level had a strike within {v.near_km} km. {v.final ? '' : 'The day’s lightning is still settling, so these can change for a few hours.'}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default function TCMVerification() {
  const { isDark } = useTheme();
  const [params, setParams] = useSearchParams();
  const [days, setDays] = useState(null);
  const [err, setErr] = useState(null);
  const top = useRef(null);
  const date = params.get('date');
  const run = params.get('run');

  useEffect(() => {
    let alive = true, timer = null;
    const load = () => archiveJson('/api/tcm-archive/verification').then((r) => {
      if (!alive) return;
      setDays(r.days);
      if (r.days.some((d) => d.pending)) timer = setTimeout(load, 8000);
    }).catch(() => { if (alive) setErr('Verification could not be loaded.'); });
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  const ready = useMemo(() => (days || []).filter((d) => !d.pending), [days]);
  const current = date && days?.some((d) => d.date === date) ? date : ready[0]?.date || null;
  const i = days ? days.findIndex((d) => d.date === current) : -1;
  const go = (d, scroll = false) => {
    setParams((p) => { const n = new URLSearchParams(p); n.set('date', d); n.delete('run'); return n; }, { replace: true });
    if (scroll) top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const setRun = (r) => setParams((p) => { const n = new URLSearchParams(p); if (r) n.set('run', r); else n.delete('run'); return n; }, { replace: true });

  const totals = useMemo(() => {
    const withData = ready.filter((d) => d.strikes.data);
    const n = withData.reduce((s, d) => s + d.strikes.on_grid, 0);
    const mr = withData.reduce((s, d) => s + d.levels[1].strikes, 0), ts = withData.reduce((s, d) => s + d.levels[0].strikes, 0);
    return { days: ready.length, lit: withData.filter((d) => d.strikes.on_grid > 0).length, n, mr: n ? mr / n : null, ts: n ? ts / n : null };
  }, [ready]);

  const hero = days && ready.length > 0 && (
    <div className="vf-stats">
      <Stat label="Days checked" value={totals.days} note={`${totals.lit} with lightning`} />
      <Stat label="Strikes" value={totals.n.toLocaleString()} note="in the forecast area" />
      <Stat label="Inside Marginal+" value={pct(totals.mr)} note="of all the strikes" />
      <Stat label="Inside any risk" value={pct(totals.ts)} note="General thunder or above" />
    </div>
  );

  return (
    <VfPage title="TCM Verification" accent="#facc15" accent2="#f97316" css={CSS} hero={hero}
      lede="Each finished day: the lightning risk TCM NOVA gave for the whole day, with the lightning the Met Office recorded drawn over it. How much of the lightning fell inside the risk areas, and how much of the risk areas saw any.">
      {err && <div className="vf-error">{err}</div>}
      {!err && days === null && <div className="vf-skel" style={{ height: 420, borderRadius: 24 }} />}
      {!err && days?.length === 0 && (
        <section className="vf-glass vf-card"><div className="vf-empty"><Target /><b>No finished days yet</b><p>Each day is checked once it is over and the Main Run that forecast it is in the TCM Archive.</p></div></section>
      )}
      {current && (
        <div ref={top} style={{ scrollMarginTop: 80 }}>
          <DayDetail key={current} date={current} run={run} setRun={setRun} dark={isDark}
            prev={days[i + 1]?.date} next={i > 0 ? days[i - 1].date : null} go={(d) => go(d)} />
        </div>
      )}
      {days?.length > 0 && (
        <section className="vf-glass vf-card">
          <div className="vf-head"><Target /><h2>Every day</h2><small>{days.length} day{days.length === 1 ? '' : 's'}, newest first</small></div>
          <div className="tv-grid">
            {days.map((d) => <DayCard key={d.date} v={d} on={d.date === current} dark={isDark} onPick={() => go(d.date, true)} />)}
          </div>
        </section>
      )}
    </VfPage>
  );
}
