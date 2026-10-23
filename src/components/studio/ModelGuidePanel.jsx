/* "From the models" for the snow and wind graphics: risk areas built from the model fields the
   Model Data page already has (lib/modelGuide), contoured at the graphic's own key and dropped in
   as editable areas.

   What each graphic takes is set in lib/graphicVariants (`guide`):
   - Snow chance / Snow risk: the chance, across 100 ECMWF ENS and AIFS ENS members, of 24 hours'
     snowfall reaching 1 cm (chance) or 5 cm (risk) within about 15 miles.
   - Snow accumulation: the snowfall over the span, the ensemble median or the UKV 2 km.
   - Wind: gusts, the UKV 2 km hourly maximum or the ECMWF ENS median.
   Over a day or any period of time, as the peak or the average, in Detailed, Smooth or Broad
   shapes (the same choices as the TCM NOVA import, and remembered with them). With the UKV, the
   period is picked from the hours its runs on the server cover. A period becomes the graphic's
   timeline window and its outlook day or days, and for gusts each stamp is marked with the level
   of the strongest gust near it (inside the view).

   "Split by time" (lib/areaEvents) gives each area its first and last hours, cuts an area two
   separate spells share, and the graphic orders them first, second… with outlines from white to
   grey: gusts from the same frames they are built from (UKV hourly, or the ensemble's 6-hourly
   medians), snow from when the UKV has it falling (0.1 mm an hour or more) inside its range. */
import React, { useEffect, useMemo, useState } from 'react';
import { DownloadCloud, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Btn, Seg, Field } from '@/components/studio/StudioUI';
import { MAP_BBOX } from '@/components/studio/studioGeo';
import { parseLocal, hourKey, toLocalInput, buildCells, stepHours, marksFromStamps, periodTimeline, periodDays } from '@/components/studio/studioTimeline';
import { SHAPES } from '@/lib/novaOutlook';
import {
  ensChance, ensMedian, detAccum, detStat, maxWithin, contourField, boxMaskOf, peakOf, dayBounds, nearestSynoptic, ukvTiming, ensTiming,
  detCoverage, FINE,
} from '@/lib/modelGuide';

const HOUR = 3600e3, SIX_H = 6 * HOUR;
const hourLabel = (ms) => new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '');
const padBox = (b) => (b ? { lonMin: b.lonMin - 0.5, lonMax: b.lonMax + 0.5, latMin: b.latMin - 0.35, latMax: b.latMax + 0.35 } : null);
const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
/* the 6-hourly synoptic times inside (from, to], at least the one nearest the end */
const synopticIn = (from, to) => {
  const out = [];
  for (let t = Math.ceil((from + 1) / SIX_H) * SIX_H; t <= to; t += SIX_H) out.push(t);
  return out.length ? out : [nearestSynoptic(to)];
};
const PREF_KEY = 'mwuk_studio_import';
const readPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } };

/** The hours the UKV runs on the server cover (hourly, from the newest run's start to the furthest
    step any run has), loaded while `on`: { cover, hours }. */
export function useUkvHours(on) {
  const [cover, setCover] = useState(null);
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    detCoverage('ukv').then((c) => live && setCover(c)).catch(() => live && setCover(null));
    return () => { live = false; };
  }, [on]);
  const hours = useMemo(() => {
    if (!cover) return [];
    const out = [];
    for (let t = Math.ceil(cover.start / HOUR) * HOUR; t <= cover.end; t += HOUR) out.push(t);
    return out;
  }, [cover]);
  return { cover, hours };
}

/** A period of the UKV's hours ({ from, to } as 'YYYY-MM-DDTHH:mm'), at least three hours long, with
    quick choices. A value outside what the UKV covers starts as its next 24 hours. */
export function UkvPeriod({ cover, hours, value, onChange, color = '#38bdf8' }) {
  const last = hours[hours.length - 1];
  /* from the next whole hour (or the UKV's first) for `h` hours, or the whole run */
  const setPeriod = (h) => {
    if (!hours.length) return;
    const a = Math.max(hours[0], Math.ceil(Date.now() / HOUR) * HOUR), b = h ? Math.min(last, a + h * HOUR) : last;
    onChange({ from: toLocalInput(new Date(a)), to: toLocalInput(new Date(b)) });
  };
  useEffect(() => {
    if (!hours.length) return;
    const a = parseLocal(value?.from)?.getTime(), b = parseLocal(value?.to)?.getTime();
    if (!(a >= hours[0] && b <= last && a < b)) setPeriod(24);
  }, [hours]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!hours.length) return <p className="sg-note"><Loader2 className="sg-spin" style={{ width: 12, height: 12, verticalAlign: -2 }} /> Finding the hours the UKV covers…</p>;
  const opt = (t) => { const v = toLocalInput(new Date(t)); return <option key={t} value={v}>{hourLabel(t)}</option>; };
  return (
    <>
      <div className="sg-grid2">
        <Field label="From">
          <select className="sg-input" value={value?.from || ''} onChange={(e) => {
            const f = e.target.value, a = parseLocal(f).getTime();
            /* an end now under three hours after the start moves on to a day after it */
            onChange({ from: f, to: (parseLocal(value?.to)?.getTime() ?? 0) >= a + 3 * HOUR ? value.to : toLocalInput(new Date(Math.min(last, a + 24 * HOUR))) });
          }}>{hours.slice(0, -3).map(opt)}</select>
        </Field>
        <Field label="To">
          <select className="sg-input" value={value?.to || ''} onChange={(e) => onChange({ ...value, to: e.target.value })}>
            {hours.filter((t) => t >= (parseLocal(value?.from)?.getTime() ?? 0) + 3 * HOUR).map(opt)}
          </select>
        </Field>
      </div>
      <div className="sg-row">
        {[['Next 12 h', 12], ['Next 24 h', 24], ['Next 48 h', 48], ['Whole run', 0]].map(([l, h]) => <Btn key={l} sm color={color} onClick={() => setPeriod(h)}>{l}</Btn>)}
      </div>
      <p className="sg-note">The UKV here runs from {hourLabel(hours[0])} to {hourLabel(last)} (the {new Date(cover.run).toISOString().slice(11, 13)}Z run reaches furthest).</p>
    </>
  );
}

/** `guide`: the variant's recipe; `levels`: its base ladder ({ id, short }) lowest first. */
export default function ModelGuidePanel({ guide, levels, view, validDate, timeline, onImport }) {
  const days = useMemo(() => {
    const out = [], d = new Date();
    for (let i = 0; i < 7; i++) { out.push(d.toLocaleDateString('en-CA')); d.setDate(d.getDate() + 1); }
    return out;
  }, []);
  const [span, setSpan] = useState(days.includes(validDate) ? validDate : days[0]);
  const [custom, setCustom] = useState(() => ({ from: timeline?.from || '', to: timeline?.to || '' }));
  const [source, setSource] = useState(guide.sources?.[0]?.[0] || 'ens');
  const [prefs, setPrefs] = useState(() => ({ stat: 'peak', shape: 'smooth', timed: true, ...readPrefs() }));
  const [marks, setMarks] = useState(true);       // a period's timeline stamps marked from the gusts
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const pref = (k) => (v) => setPrefs((p) => { const n = { ...p, [k]: v }; try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrefs(), ...n })); } catch { /* storage blocked */ } return n; });
  const isDay = span !== 'custom';
  const hasStat = guide.kind !== 'amount';
  const usesUkv = source === 'ukv' && guide.kind !== 'chance';

  const { cover, hours } = useUkvHours(usesUkv);
  /* with the UKV, only the days it reaches */
  const shownDays = usesUkv && cover ? days.filter((d) => dayBounds(d)[0] < cover.end && dayBounds(d)[1] > cover.start) : days;
  useEffect(() => { if (span !== 'custom' && !shownDays.includes(span)) setSpan(shownDays[0] || 'custom'); }, [shownDays.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (mode) => {
    setBusy(true);
    setStatus('Finding the model runs…');
    try {
      let from, to;
      if (isDay) [from, to] = dayBounds(span);
      else { from = parseLocal(custom.from)?.getTime(); to = parseLocal(custom.to)?.getTime(); }
      if (!(from < to)) throw new Error('The end has to be after the start.');
      if (usesUkv && !isDay && to - from < 3 * HOUR) throw new Error('Pick at least three hours of the UKV.');
      /* the view, or the whole map: nothing beyond its edges, where it would land under the cards */
      const box = view && !view.whole ? padBox(view.box) : MAP_BBOX;
      const opts = { onStatus: setStatus };
      const how = prefs.stat === 'mean' ? 'mean' : 'peak';
      const steps = [];
      /* each UKV hour's strongest gust inside the view, read as the frames go by, for the timeline */
      const ukvMask = usesUkv ? boxMaskOf({ nx: FINE.nx, ny: FINE.ny, k: 1 }, box) : null, hourly = [];
      let field;
      if (guide.kind === 'chance') {
        field = await ensChance(['ecmwf_ens', 'aifs_ens'], 'snow_24h', isDay ? [nearestSynoptic(to)] : synopticIn(from, to), guide.threshold, how, opts);
        if (field) field = maxWithin(field, 1);
      } else if (guide.kind === 'amount') {
        field = source === 'ukv'
          ? await detAccum('ukv', 'snow_total', from, to, opts)
          : await ensMedian('ecmwf_ens', 'snow_24h', [nearestSynoptic(to)], 'last', opts);
      } else {
        field = source === 'ukv'
          ? await detStat('ukv', 'gust_max', from, to, how, { ...opts, onStep: (st) => hourly.push({ t: st.t, v: peakOf(st, ukvMask) }) })
          : await ensMedian('ecmwf_ens', 'gust', synopticIn(from, to), how, { ...opts, onStep: (st) => steps.push(st) });
      }
      if (!field) throw new Error(`No ${source === 'ukv' && guide.kind !== 'chance' ? 'UKV' : 'ensemble'} run covers that time yet.`);
      const mask = boxMaskOf(field, box);
      const scale = guide.scale ?? 1;
      if (scale !== 1) field = { ...field, data: field.data.map((v) => v * scale) };
      const thr = levels.map((l, i) => ({ id: l.id, min: guide.mins[i] }));
      /* when each area happens: gusts from their own frames, snow from when the UKV has it falling */
      let timing = null;
      if (prefs.timed) {
        setStatus('Timing the areas…');
        if (guide.kind === 'gust') timing = source === 'ukv' ? await ukvTiming('gust_max', from, to, field, (i, min) => min / scale, opts) : ensTiming(steps, field, (i, min) => min / scale);
        else timing = await ukvTiming('snow_1h', from, to, field, () => 0.1, opts);
      }
      /* each level's areas in time order, so the first in the span is the first on the graphic */
      const areas = contourField(field, thr, mask, prefs.shape, timing).flatMap((l) => l.areas
        .map((a) => ({ riskLevel: l.id, ring: a.ring, ...(a.from != null ? { from: hourKey(a.from), to: hourKey(a.to), t: a.from } : {}) }))
        .sort((a, b) => (a.t ?? 0) - (b.t ?? 0)))
        .map(({ t, ...a }) => a);
      const spells = new Set(areas.filter((a) => a.from).map((a) => `${a.from}|${a.to}`)).size;
      const out = { mode, day: isDay ? span : null, areas };
      /* a period: the graphic's timeline window and day or days, and for gusts each stamp's level */
      let marked = false;
      if (!isDay) {
        const tl = periodTimeline(timeline, custom.from, custom.to);
        [out.day, out.day2] = periodDays(from, to);
        if (guide.kind === 'gust' && marks) {
          const peaks = source === 'ukv' ? hourly : steps.map((st) => ({ t: st.t, v: peakOf(st, mask) }));
          const cells = buildCells(tl), tol = Math.max(stepHours(tl.gran) / 2, source === 'ukv' ? 0.5 : 3) * HOUR;
          const levelOf = (v) => { let id = null; for (const t of thr) if (v * scale >= t.min) id = t.id; return id; };
          const lv = cells.map((c) => { const near = peaks.filter((p) => Math.abs(p.t - c.ms) <= tol); return near.length ? levelOf(Math.max(...near.map((p) => p.v))) : null; });
          tl.risk = marksFromStamps(cells, lv, Object.fromEntries(thr.map((t, i) => [t.id, i])));
          marked = lv.some(Boolean);
        }
        out.timeline = tl;
      }
      onImport(out);
      const pk = peakOf(field, mask);
      const word = hasStat && how === 'mean' ? 'highest average' : 'peak';
      const timed = !prefs.timed ? '' : spells > 1 ? ` · ${spells} spells, first to last` : timing ? '' : guide.kind === 'gust' ? ' · one time only, nothing to split' : ' · not timed (beyond the UKV)';
      setStatus(`${(field.used || []).join(' + ')} · ${word} ${guide.fmt(pk)}${timed}`);
      toast.success(`${areas.length} area${areas.length === 1 ? '' : 's'} from the models, ${word} ${guide.fmt(pk)}${spells > 1 ? `, in ${spells} spells` : ''}${isDay ? '' : `, timeline set to the period${marked ? ' and marked' : ''}`}`);
    } catch (e) {
      console.error('[model guide]', e);
      setStatus(null);
      toast.error(e.message || 'The model fields could not be read');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sg-panel">
      <p className="sg-note"><b>{guide.title}</b> {guide.note}</p>
      <div>
        <span className="sg-label">Over</span>
        <Seg value={span} onChange={setSpan} color="#38bdf8" options={[...shownDays.map((d) => [d, dayLabel(d)]), ['custom', 'Period…']]} />
      </div>
      {!isDay && usesUkv && <UkvPeriod cover={cover} hours={hours} value={custom} onChange={setCustom} />}
      {!isDay && !usesUkv && (
        <div className="sg-grid2">
          <Field label="From"><input type="datetime-local" className="sg-input" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></Field>
          <Field label="To"><input type="datetime-local" className="sg-input" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></Field>
        </div>
      )}
      {guide.sources && (
        <div>
          <span className="sg-label">Model</span>
          <Seg value={source} onChange={setSource} color="#38bdf8" options={guide.sources} />
        </div>
      )}
      <div className="sg-row">
        {hasStat && (
          <div>
            <span className="sg-label">Value</span>
            <Seg value={prefs.stat} onChange={pref('stat')} color="#38bdf8" options={[['peak', 'Peak'], ['mean', 'Average']]} />
          </div>
        )}
        <div>
          <span className="sg-label">Shapes</span>
          <Seg value={prefs.shape} onChange={pref('shape')} color="#38bdf8" options={Object.entries(SHAPES).map(([k, v]) => [k, v.label])} />
        </div>
        <div>
          <span className="sg-label">Timing</span>
          <Btn sm on={prefs.timed} color="#38bdf8" onClick={() => pref('timed')(!prefs.timed)} title="Give each area its hours, and split areas two spells share">Split by time</Btn>
          {guide.kind === 'gust' && !isDay && <Btn sm on={marks} color="#38bdf8" onClick={() => setMarks((v) => !v)} title="Mark each timeline stamp with the level of the strongest gust near it">Timeline</Btn>}
        </div>
      </div>
      <div className="sg-row">
        <Btn primary color="#0ea5e9" icon={busy ? Loader2 : DownloadCloud} disabled={busy} onClick={() => run('replace')}>{busy ? 'Working…' : 'Build areas, replacing'}</Btn>
        <Btn disabled={busy} onClick={() => run('append')}>Add to areas</Btn>
      </div>
      {status && <span className="sg-status" style={{ '--c': busy ? '#facc15' : '#4ade80' }}><i />{status}</span>}
      <p className="sg-note">
        {view && !view.whole ? `Inside the ${view.label} view only. ` : ''}
        {guide.kind === 'chance' ? (isDay ? 'A day is its 24-hour snowfall. ' : 'Over dates and times, the 24-hour snowfall ending at each 6-hourly step inside them. ') : ''}
        {guide.kind === 'amount' ? (source === 'ukv' ? 'The UKV total is what falls between the start and the end. ' : 'The ensemble gives the 24 hours ending at the end. ') : ''}
        {hasStat ? (prefs.stat === 'mean' ? 'Average shows how long it lasts at each place. ' : 'Peak is the most at any time. ') : ''}
        {prefs.timed ? (guide.kind === 'gust' ? 'Split by time times each area from the same frames. ' : 'Split by time times each area by when the UKV has snow falling there (within its range). ') : ''}
        Levels follow this graphic's key ({levels.map((l, i) => `${l.short} ${guide.fmt(guide.mins[i])}`).join(', ')}).
        {isDay ? ' Picking a day moves the outlook day to it.' : ` The period becomes the graphic's timeline and its outlook day or days${guide.kind === 'gust' && marks ? ', each stamp marked at the strongest gust near it' : ''}.`} A field the server has not built yet takes a minute or two the first time.
      </p>
    </div>
  );
}
