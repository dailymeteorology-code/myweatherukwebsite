/* "From the models" for the snow and wind graphics: risk areas built from the model fields the
   Model Data page already has (lib/modelGuide), contoured at the graphic's own key and dropped in
   as editable areas.

   What each graphic takes is set in lib/graphicVariants (`guide`):
   - Snow chance / Snow risk: the chance, across 100 ECMWF ENS and AIFS ENS members, of 24 hours'
     snowfall reaching 1 cm (chance) or 5 cm (risk) within about 15 miles.
   - Snow accumulation: the snowfall over the span, the ensemble median or the UKV 2 km.
   - Wind: gusts, the UKV 2 km hourly maximum or the ECMWF ENS median.
   Over a day or any dates and times, as the peak or the average, in Detailed, Smooth or Broad
   shapes (the same choices as the TCM NOVA import, and remembered with them).

   "Split by time" (lib/areaEvents) gives each area its first and last hours, cuts an area two
   separate spells share, and the graphic orders them first, second… with outlines from white to
   grey: gusts from the same frames they are built from (UKV hourly, or the ensemble's 6-hourly
   medians), snow from when the UKV has it falling (0.1 mm an hour or more) inside its range. */
import React, { useMemo, useState } from 'react';
import { DownloadCloud, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Btn, Seg, Field } from '@/components/studio/StudioUI';
import { MAP_BBOX } from '@/components/studio/studioGeo';
import { parseLocal, hourKey } from '@/components/studio/studioTimeline';
import { SHAPES } from '@/lib/novaOutlook';
import {
  ensChance, ensMedian, detAccum, detStat, maxWithin, contourField, boxMaskOf, peakOf, dayBounds, nearestSynoptic, ukvTiming, ensTiming,
} from '@/lib/modelGuide';

const SIX_H = 6 * 3600e3;
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
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const pref = (k) => (v) => setPrefs((p) => { const n = { ...p, [k]: v }; try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrefs(), ...n })); } catch { /* storage blocked */ } return n; });
  const isDay = span !== 'custom';
  const hasStat = guide.kind !== 'amount';

  const run = async (mode) => {
    setBusy(true);
    setStatus('Finding the model runs…');
    try {
      let from, to;
      if (isDay) [from, to] = dayBounds(span);
      else { from = parseLocal(custom.from)?.getTime(); to = parseLocal(custom.to)?.getTime(); }
      if (!(from < to)) throw new Error('The end has to be after the start.');
      const opts = { onStatus: setStatus };
      const how = prefs.stat === 'mean' ? 'mean' : 'peak';
      const steps = [];
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
          ? await detStat('ukv', 'gust_max', from, to, how, opts)
          : await ensMedian('ecmwf_ens', 'gust', synopticIn(from, to), how, { ...opts, onStep: (st) => steps.push(st) });
      }
      if (!field) throw new Error(`No ${source === 'ukv' && guide.kind !== 'chance' ? 'UKV' : 'ensemble'} run covers that time yet.`);
      /* the view, or the whole map: nothing beyond its edges, where it would land under the cards */
      const mask = boxMaskOf(field, view && !view.whole ? padBox(view.box) : MAP_BBOX);
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
      onImport({ mode, day: isDay ? span : null, areas });
      const pk = peakOf(field, mask);
      const word = hasStat && how === 'mean' ? 'highest average' : 'peak';
      const timed = !prefs.timed ? '' : spells > 1 ? ` · ${spells} spells, first to last` : timing ? '' : guide.kind === 'gust' ? ' · one time only, nothing to split' : ' · not timed (beyond the UKV)';
      setStatus(`${(field.used || []).join(' + ')} · ${word} ${guide.fmt(pk)}${timed}`);
      toast.success(`${areas.length} area${areas.length === 1 ? '' : 's'} from the models, ${word} ${guide.fmt(pk)}${spells > 1 ? `, in ${spells} spells` : ''}`);
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
        <Seg value={span} onChange={setSpan} color="#38bdf8" options={[...days.map((d) => [d, dayLabel(d)]), ['custom', 'Dates & times…']]} />
      </div>
      {!isDay && (
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
        {isDay ? ' Picking a day moves the outlook day to it.' : ''} A field the server has not built yet takes a minute or two the first time.
      </p>
    </div>
  );
}
