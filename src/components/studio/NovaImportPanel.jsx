/* Imports TCM NOVA's newest Main Run into the thunderstorm graphic: its thunderstorm probability
   as editable risk areas, optionally its severe probability as Severe areas, its 3-hourly frames
   as the timeline, and its hazard probabilities as the Hazards card's percentages. All of it is
   the peak over the chosen London day (or the timeline's window) inside the map view. */
import React, { useEffect, useState } from 'react';
import { DownloadCloud, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { novaLatest, novaField, boxMask, contourLevels, peak, framesIn, framesPeak } from '@/lib/novaOutlook';
import { buildCells, shiftTimeline } from '@/components/studio/studioTimeline';
import { Btn, Seg } from '@/components/studio/StudioUI';
import { MAP_BBOX } from '@/components/studio/studioGeo';

const dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 864e5);
const dayName = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const padBox = (b) => (b ? { lonMin: b.lonMin - 0.5, lonMax: b.lonMax + 0.5, latMin: b.latMin - 0.35, latMax: b.latMax + 0.35 } : null);

/** `levels`: the graphic's base ladder, lowest first, each with `keyMin` (its key's lower bound)
    and `novaMin` (NOVA's own word band), both 0..1. `hazardFields`: { hazardId: NOVA field }. */
export default function NovaImportPanel({ view, timeline, validDate, levels, hazardFields, onImport }) {
  const [m, setM] = useState(null);
  const [err, setErr] = useState(null);
  const [span, setSpan] = useState('day0');
  const [bands, setBands] = useState('key');
  const [want, setWant] = useState({ areas: true, severe: false, timeline: true, hazards: true });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    novaLatest().then((x) => live && setM(x)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, []);
  /* open on the outlook day when the run has it */
  useEffect(() => {
    if (!m) return;
    const i = (m.days || []).findIndex((d) => d.date === validDate);
    if (i >= 0) setSpan(`day${i}`);
  }, [m]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <p className="sg-note" style={{ color: 'var(--sg-amber)' }}>{err}</p>;
  if (!m) return <p className="sg-note"><Loader2 className="sg-spin" style={{ width: 12, height: 12, verticalAlign: -2 }} /> Loading the newest TCM NOVA run…</p>;

  const days = (m.days || []).slice(0, 4);
  const day = span.startsWith('day') ? days[Number(span.slice(3))]?.date : null;
  const thr = levels.map((l) => ({ id: l.id, min: bands === 'key' ? l.keyMin : l.novaMin }));
  const levelOf = (p) => { let id = null; for (const t of thr) if (p >= t.min) id = t.id; return id; };
  const init = new Date(m.init_utc);
  const toggle = (k) => setWant((w) => ({ ...w, [k]: !w[k] }));

  const run = async (mode) => {
    setBusy(true);
    try {
      /* the view, or the whole map: nothing beyond its edges, where it would land under the cards */
      const mask = boxMask(m.grid, view && !view.whole ? padBox(view.box) : MAP_BBOX);
      /* the window the timeline will have once the outlook day moves to the imported day */
      const tl = day && day !== validDate ? shiftTimeline(timeline, dayDiff(validDate, day)) : timeline;
      const cells = buildCells(tl);
      const winFrames = cells.length ? framesIn(m, cells[0].ms, cells[cells.length - 1].end) : [];
      const fieldOver = (name) => (day ? novaField(m, { day }, name) : winFrames.length ? framesPeak(m, winFrames, name) : null);
      const out = { mode, day };

      if (want.areas || want.severe) {
        const p = await fieldOver('p_thunder');
        if (!p) throw new Error('The timeline window is outside this NOVA run.');
        out.peak = peak(p, mask);
        if (want.areas) out.areas = contourLevels(p, m.grid, thr, mask).flatMap((l) => l.rings.map((ring) => ({ riskLevel: l.id, ring })));
        if (want.severe) {
          const s = await fieldOver('p_severe');
          out.areas = [...(out.areas || []), ...contourLevels(s, m.grid, [{ id: 'Severe', min: 0.15 }], mask).flatMap((l) => l.rings.map((ring) => ({ riskLevel: l.id, ring })))];
        }
      }
      if (want.timeline && cells.length) {
        const peaks = await Promise.all(winFrames.map(async (f) => ({ t: f.t, v: peak(await novaField(m, { lead: f.lead }, 'p_thunder'), mask) })));
        const risk = {};
        for (const c of cells) {
          const inCell = peaks.filter((p) => p.t >= c.ms - 90 * 60e3 && p.t < c.end + 90 * 60e3);
          if (!inCell.length) continue;
          const lv = levelOf(Math.max(...inCell.map((p) => p.v)));
          if (lv) for (const h of c.hours) risk[h] = lv;
        }
        out.timeline = { ...tl, risk };
      }
      if (want.hazards) {
        const d = day || new Date(cells[0]?.ms || Date.now()).toLocaleDateString('en-CA');
        const hasDay = (m.days || []).some((x) => x.date === d);
        if (hasDay) {
          const entries = await Promise.all(Object.entries(hazardFields).map(async ([id, f]) => [id, Math.round(100 * peak(await novaField(m, { day: d }, f), mask))]));
          out.hazards = Object.fromEntries(entries);
        }
      }
      onImport(out);
      const n = out.areas?.length || 0;
      toast.success(`TCM NOVA imported: ${n} area${n === 1 ? '' : 's'}${out.peak != null ? `, peak ${Math.round(out.peak * 100)}%` : ''}${out.timeline ? ', timeline filled' : ''}${out.hazards ? ', hazard chances set' : ''}`);
    } catch (e) {
      console.error('[nova import]', e);
      toast.error(e.message || 'TCM NOVA import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sg-panel">
      <div className="sg-row" style={{ justifyContent: 'space-between' }}>
        <span className="sg-note">
          <b>Main Run {String(init.getUTCHours()).padStart(2, '0')}Z</b> {init.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {m.horizon_h} h
          {m.calibration && /uncal/i.test(m.calibration) ? ' · uncalibrated' : ''}
        </span>
      </div>
      <div>
        <span className="sg-label">Peak over</span>
        <Seg value={span} onChange={setSpan} color="#818cf8" options={[
          ...days.map((d, i) => [`day${i}`, `${dayName(d.date)}${d.stats?.p_thunder ? ` · ${Math.round(d.stats.p_thunder.max * 100)}%` : ''}`]),
          ['window', 'Timeline window'],
        ]} />
      </div>
      <div>
        <span className="sg-label">Bands</span>
        <Seg value={bands} onChange={setBands} color="#818cf8" options={[['key', 'Graphic key (5/12/22/35/50/65%)'], ['nova', 'NOVA words (2/5/15/30/45/60%)']]} />
      </div>
      <div className="sg-row">
        <Btn sm on={want.areas} color="#818cf8" onClick={() => toggle('areas')}>Risk areas</Btn>
        <Btn sm on={want.severe} color="#818cf8" onClick={() => toggle('severe')}>Severe ≥15%</Btn>
        <Btn sm on={want.timeline} color="#818cf8" onClick={() => toggle('timeline')}>Timeline</Btn>
        <Btn sm on={want.hazards} color="#818cf8" onClick={() => toggle('hazards')}>Hazard chances</Btn>
      </div>
      <div className="sg-row">
        <Btn primary color="#6366f1" icon={busy ? Loader2 : DownloadCloud} disabled={busy} onClick={() => run('replace')}>{busy ? 'Importing…' : 'Import, replacing areas'}</Btn>
        <Btn disabled={busy} onClick={() => run('append')}>Add to areas</Btn>
      </div>
      <p className="sg-note">
        {view && !view.whole ? `Inside the ${view.label} view only. ` : ''}Areas are smoothed over about 6 km like a drawn outlook, and stay editable.
        {day ? ' Picking a day moves the outlook day (and the timeline) to it.' : ''}
      </p>
    </div>
  );
}
