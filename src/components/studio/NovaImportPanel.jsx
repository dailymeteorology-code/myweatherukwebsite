/* Imports a TCM NOVA run into the thunderstorm graphic (the newest Main Run, or any Main Run or
   Hyper-Short run of the last 48 hours): its thunderstorm probability
   as editable risk areas, optionally its severe probability as Severe areas, its 3-hourly frames
   as the timeline, and its hazard probabilities as the Hazards card's percentages.

   Each is the peak or the average over a London day, the timeline's window or any dates and times,
   inside the map view, and the areas come Detailed (NOVA's own look), Smooth or Broad (fewer,
   rounder areas, the way an outlook is drawn by hand).

   "Split by time" matches the areas with the run's 3-hourly frames (lib/areaEvents): each gets
   its first and last hours, an area two separate spells share is cut in two, and the graphic
   orders them first, second… with outlines from white to grey. */
import React, { useEffect, useState } from 'react';
import { DownloadCloud, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { novaRecentRuns, novaRun, runName, novaField, boxMask, contourLevels, peak, framesIn, framesStat, timingFrames, SHAPES } from '@/lib/novaOutlook';
import { buildCells, shiftTimeline, parseLocal, toLocalInput, hourKey, marksFromStamps } from '@/components/studio/studioTimeline';
import { Btn, Seg, Field } from '@/components/studio/StudioUI';
import { MAP_BBOX } from '@/components/studio/studioGeo';

const dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 864e5);
const dayName = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const padBox = (b) => (b ? { lonMin: b.lonMin - 0.5, lonMax: b.lonMax + 0.5, latMin: b.latMin - 0.35, latMax: b.latMax + 0.35 } : null);
const dayBounds = (d) => { const a = new Date(`${d}T00:00:00`), b = new Date(a); b.setDate(b.getDate() + 1); return [a.getTime(), b.getTime()]; };
/* the days a run covers: its day summaries (Main Run), else the days of its frames (Hyper-Short) */
const runDays = (m) => (m.days?.length ? m.days.map((d) => ({ ...d, summary: true }))
  : [...new Set((m.frames || []).filter((f) => f.valid).map((f) => new Date(f.valid).toLocaleDateString('en-CA')))].map((date) => ({ date })));
const runKey = (r) => `${r.product}|${r.run_id}`;

/* the choices that are a matter of taste are remembered */
const PREF_KEY = 'mwuk_studio_import';
const readPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } };

/** `levels`: the graphic's base ladder, lowest first, each with `keyMin` (its key's lower bound)
    and `novaMin` (NOVA's own word band), both 0..1. `hazardFields`: { hazardId: NOVA field }. */
export default function NovaImportPanel({ view, timeline, validDate, levels, hazardFields, onImport }) {
  const [runs, setRuns] = useState(null);       // the last 48 hours' runs, newest first
  const [pick, setPick] = useState(null);       // the run chosen ('main|main-20261023T1400Z')
  const [m, setM] = useState(null);             // its manifest
  const [err, setErr] = useState(null);
  const [span, setSpan] = useState('day0');
  const [custom, setCustom] = useState(() => ({ from: timeline.from, to: timeline.to }));
  const [prefs, setPrefs] = useState(() => ({ bands: 'key', stat: 'peak', shape: 'smooth', timed: true, ...readPrefs() }));
  const [want, setWant] = useState({ areas: true, severe: false, timeline: true, hazards: true });
  const [busy, setBusy] = useState(false);
  const pref = (k) => (v) => setPrefs((p) => { const n = { ...p, [k]: v }; try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrefs(), ...n })); } catch { /* storage blocked */ } return n; });

  /* the runs to choose from; the newest Main Run first in mind */
  useEffect(() => {
    let live = true;
    novaRecentRuns(48).then((rs) => {
      if (!live) return;
      if (!rs.length) { setErr('No TCM NOVA run in the last 48 hours.'); return; }
      setRuns(rs);
      setPick(runKey(rs.find((r) => r.product === 'main') || rs[0]));
    }).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!pick) return undefined;
    let live = true;
    const [product, id] = pick.split('|');
    setM(null);
    novaRun(product, id).then((x) => live && setM(x)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [pick]);
  /* open on the outlook day when the run has it */
  useEffect(() => {
    if (!m) return;
    const i = runDays(m).findIndex((d) => d.date === validDate);
    setSpan(i >= 0 ? `day${i}` : 'window');
  }, [m]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <p className="sg-note" style={{ color: 'var(--sg-amber)' }}>{err}</p>;
  const runPicker = runs && (
    <Field label="Run">
      <select className="sg-input" value={pick || ''} onChange={(e) => setPick(e.target.value)}>
        {runs.map((r) => <option key={runKey(r)} value={runKey(r)}>{runName(r)} · {r.horizon_h} h</option>)}
      </select>
    </Field>
  );
  if (!m) return <div className="sg-panel">{runPicker}<p className="sg-note"><Loader2 className="sg-spin" style={{ width: 12, height: 12, verticalAlign: -2 }} /> Loading the TCM NOVA run…</p></div>;

  const days = runDays(m).slice(0, 4);
  const day = span.startsWith('day') ? days[Number(span.slice(3))]?.date : null;
  const thr = levels.map((l) => ({ id: l.id, min: prefs.bands === 'key' ? l.keyMin : l.novaMin }));
  const levelOf = (p) => { let id = null; for (const t of thr) if (p >= t.min) id = t.id; return id; };
  const init = new Date(m.init_utc);
  const toggle = (k) => setWant((w) => ({ ...w, [k]: !w[k] }));
  const statWord = prefs.stat === 'mean' ? 'average' : 'peak';

  const run = async (mode) => {
    setBusy(true);
    try {
      /* the view, or the whole map: nothing beyond its edges, where it would land under the cards */
      const mask = boxMask(m.grid, view && !view.whole ? padBox(view.box) : MAP_BBOX);
      /* the window the timeline will have once the outlook day moves to the imported day */
      const tl = day && day !== validDate ? shiftTimeline(timeline, dayDiff(validDate, day)) : timeline;
      const cells = buildCells(tl);
      /* the span the areas and hazards are taken over */
      let from, to;
      if (day) [from, to] = dayBounds(day);
      else if (span === 'custom') { from = parseLocal(custom.from)?.getTime(); to = parseLocal(custom.to)?.getTime(); }
      else { from = cells[0]?.ms; to = cells[cells.length - 1]?.end; }
      if (!(from < to)) throw new Error('The end has to be after the start.');
      const spanFrames = framesIn(m, from, to);
      /* a day's peak is in a Main Run's day summaries; anything else is worked out from the frames */
      const summary = day && days.find((d) => d.date === day)?.summary;
      const fieldOver = (name) => (summary && prefs.stat === 'peak' ? novaField(m, { day }, name)
        : spanFrames.length ? framesStat(m, spanFrames, name, prefs.stat) : null);
      const out = { mode, day };

      if (want.areas || want.severe) {
        const p = await fieldOver('p_thunder');
        if (!p) throw new Error('Those dates are outside this NOVA run.');
        out.peak = peak(p, mask);
        /* each level's areas in time order, so the first in the day is the first on the graphic */
        const asAreas = (levels) => levels.flatMap((l) => l.areas
          .map((a) => ({ riskLevel: l.id, ring: a.ring, ...(a.from != null ? { from: hourKey(a.from), to: hourKey(a.to), t: a.from } : {}) }))
          .sort((a, b) => (a.t ?? 0) - (b.t ?? 0)))
          .map(({ t, ...a }) => a);
        const timing = async (name) => (prefs.timed ? timingFrames(m, spanFrames, name, mask) : null);
        if (want.areas) out.areas = asAreas(contourLevels(p, m.grid, thr, mask, prefs.shape, await timing('p_thunder')));
        if (want.severe) {
          const s = await fieldOver('p_severe');
          out.areas = [...(out.areas || []), ...asAreas(contourLevels(s, m.grid, [{ id: 'Severe', min: 0.15 }], mask, prefs.shape, await timing('p_severe')))];
        }
      }
      if (want.timeline && cells.length) {
        /* each stamp takes the frames within 90 minutes of it (NOVA is 3-hourly) */
        const winFrames = framesIn(m, cells[0].ms - 90 * 60e3, cells[cells.length - 1].ms + 90 * 60e3 + 1);
        const peaks = await Promise.all(winFrames.map(async (f) => ({ t: f.t, v: peak(await novaField(m, { lead: f.lead }, 'p_thunder'), mask) })));
        const stampLv = cells.map((c) => {
          const near = peaks.filter((p) => Math.abs(p.t - c.ms) <= 90 * 60e3);
          return near.length ? levelOf(Math.max(...near.map((p) => p.v))) : null;
        });
        out.timeline = { ...tl, v: 2, risk: marksFromStamps(cells, stampLv, Object.fromEntries(thr.map((t, i) => [t.id, i]))) };
      }
      if (want.hazards && (day || spanFrames.length)) {
        const entries = await Promise.all(Object.entries(hazardFields).map(async ([id, f]) => { const d = await fieldOver(f); return [id, d ? Math.round(100 * peak(d, mask)) : 0]; }));
        out.hazards = Object.fromEntries(entries);
      }
      onImport(out);
      const n = out.areas?.length || 0;
      const spells = new Set((out.areas || []).filter((a) => a.from).map((a) => `${a.from}|${a.to}`)).size;
      toast.success(`TCM NOVA imported: ${n} area${n === 1 ? '' : 's'}${spells > 1 ? ` in ${spells} spells, first to last` : ''}${out.peak != null ? `, highest ${statWord} ${Math.round(out.peak * 100)}%` : ''}${out.timeline ? ', timeline filled' : ''}${out.hazards ? ', hazard chances set' : ''}`);
    } catch (e) {
      console.error('[nova import]', e);
      toast.error(e.message || 'TCM NOVA import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sg-panel">
      {runPicker}
      <span className="sg-note">
        <b>{runName(m)}</b> · {m.horizon_h} h{m.product === 'hyper' ? `, every ${m.step_min || 30} min` : ', 3-hourly'}
        {m.calibration && /uncal/i.test(m.calibration) ? ' · uncalibrated' : ''}
      </span>
      <div>
        <span className="sg-label">Over</span>
        <Seg value={span} onChange={setSpan} color="#818cf8" options={[
          ...days.map((d, i) => [`day${i}`, `${dayName(d.date)}${d.stats?.p_thunder ? ` · ${Math.round(d.stats.p_thunder.max * 100)}%` : ''}`]),
          ['window', 'Timeline window'], ['custom', 'Dates & times…'],
        ]} />
      </div>
      {span === 'custom' && (
        <div className="sg-grid2">
          <Field label="From"><input type="datetime-local" className="sg-input" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></Field>
          <Field label="To"><input type="datetime-local" className="sg-input" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></Field>
        </div>
      )}
      {span === 'custom' && <p className="sg-note">This run goes from {toLocalInput(init).replace('T', ' ')} for {m.horizon_h} hours, in {m.product === 'hyper' ? `${m.step_min || 30}-minute` : '3-hour'} steps.</p>}
      <div className="sg-row">
        <div>
          <span className="sg-label">Value</span>
          <Seg value={prefs.stat} onChange={pref('stat')} color="#818cf8" options={[['peak', 'Peak'], ['mean', 'Average']]} />
        </div>
        <div>
          <span className="sg-label">Shapes</span>
          <Seg value={prefs.shape} onChange={pref('shape')} color="#818cf8" options={Object.entries(SHAPES).map(([k, v]) => [k, v.label])} />
        </div>
      </div>
      <div>
        <span className="sg-label">Bands</span>
        <Seg value={prefs.bands} onChange={pref('bands')} color="#818cf8" options={[['key', 'Graphic key (5/12/22/35/50/65%)'], ['nova', 'NOVA words (2/5/15/30/45/60%)']]} />
      </div>
      <div className="sg-row">
        <Btn sm on={want.areas} color="#818cf8" onClick={() => toggle('areas')}>Risk areas</Btn>
        <Btn sm on={want.severe} color="#818cf8" onClick={() => toggle('severe')}>Severe ≥15%</Btn>
        <Btn sm on={want.timeline} color="#818cf8" onClick={() => toggle('timeline')}>Timeline</Btn>
        <Btn sm on={want.hazards} color="#818cf8" onClick={() => toggle('hazards')}>Hazard chances</Btn>
        <Btn sm on={prefs.timed} color="#818cf8" onClick={() => pref('timed')(!prefs.timed)} title="Give each area its hours from NOVA's 3-hourly frames, and split areas two spells share">Split by time</Btn>
      </div>
      <div className="sg-row">
        <Btn primary color="#6366f1" icon={busy ? Loader2 : DownloadCloud} disabled={busy} onClick={() => run('replace')}>{busy ? 'Importing…' : 'Import, replacing areas'}</Btn>
        <Btn disabled={busy} onClick={() => run('append')}>Add to areas</Btn>
      </div>
      <p className="sg-note">
        {view && !view.whole ? `Inside the ${view.label} view only. ` : ''}
        {prefs.stat === 'mean' ? 'Average: the mean of the 3-hourly frames at each place, so it shows how long a risk lasts. ' : 'Peak: the highest chance at any time. '}
        {prefs.shape === 'detailed' ? 'Detailed keeps NOVA\'s own outlines.' : prefs.shape === 'smooth' ? 'Smooth gives fewer, rounder areas.' : 'Broad gives a few big, simple areas, the way an outlook is drawn by hand.'}
        {prefs.timed ? ' Split by time gives each area its own hours (first, second…) and outlines them white to grey, cutting an area that two spells share.' : ''}
        {' '}The timeline always takes each hour's peak. Areas stay editable.
        {day ? ' Picking a day moves the outlook day (and the timeline) to it.' : ''}
      </p>
    </div>
  );
}
