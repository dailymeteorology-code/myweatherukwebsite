/* "From the models" for the snow and wind graphics: risk areas built from the model fields the
   Model Data page already has (lib/modelGuide), contoured at the graphic's own key and dropped in
   as editable areas.

   What each graphic takes is set in lib/graphicVariants (`guide`):
   - Snow chance / Snow risk: the chance, across 100 ECMWF ENS and AIFS ENS members, of the day's
     snowfall reaching 1 cm (chance) or 5 cm (risk) within about 15 miles.
   - Snow accumulation: the day's snowfall, the ensemble median or the UKV 2 km.
   - Wind: the day's peak gust, the UKV 2 km hourly maximum or the ECMWF ENS median. */
import React, { useMemo, useState } from 'react';
import { DownloadCloud, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Btn, Seg } from '@/components/studio/StudioUI';
import { MAP_BBOX } from '@/components/studio/studioGeo';
import {
  ensChance, ensMedian, detAccum, detMax, maxWithin, blur, contourField, boxMaskOf, peakOf, dayBounds, nearestSynoptic,
} from '@/lib/modelGuide';

const padBox = (b) => (b ? { lonMin: b.lonMin - 0.5, lonMax: b.lonMax + 0.5, latMin: b.latMin - 0.35, latMax: b.latMax + 0.35 } : null);
const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** `guide`: the variant's recipe; `levels`: its base ladder ({ id, short }) lowest first. */
export default function ModelGuidePanel({ guide, levels, view, validDate, onImport }) {
  const days = useMemo(() => {
    const out = [], d = new Date();
    for (let i = 0; i < 7; i++) { out.push(d.toLocaleDateString('en-CA')); d.setDate(d.getDate() + 1); }
    return out;
  }, []);
  const [day, setDay] = useState(days.includes(validDate) ? validDate : days[0]);
  const [source, setSource] = useState(guide.sources?.[0]?.[0] || 'ens');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const run = async (mode) => {
    setBusy(true);
    setStatus('Finding the model runs…');
    try {
      const [from, to] = dayBounds(day);
      const opts = { onStatus: setStatus };
      let field;
      if (guide.kind === 'chance') {
        field = await ensChance(['ecmwf_ens', 'aifs_ens'], 'snow_24h', nearestSynoptic(to), guide.threshold, opts);
        if (field) field = maxWithin(field, 1);
      } else if (guide.kind === 'amount') {
        field = source === 'ukv'
          ? await detAccum('ukv', 'snow_total', from, to, opts)
          : await ensMedian('ecmwf_ens', 'snow_24h', [nearestSynoptic(to)], 'last', opts);
        if (field && source === 'ukv') field = blur(field, 2);
      } else {
        if (source === 'ukv') {
          field = await detMax('ukv', 'gust_max', from, to, opts);
          if (field) field = blur(field, 3);
        } else {
          const steps = [];
          for (let t = nearestSynoptic(from) + 6 * 3600e3; t <= nearestSynoptic(to); t += 6 * 3600e3) steps.push(t);
          field = await ensMedian('ecmwf_ens', 'gust', steps, 'max', opts);
        }
      }
      if (!field) throw new Error(`No ${source === 'ukv' ? 'UKV' : 'ensemble'} run covers ${dayLabel(day)} yet.`);
      /* the view, or the whole map: nothing beyond its edges, where it would land under the cards */
      const mask = boxMaskOf(field, view && !view.whole ? padBox(view.box) : MAP_BBOX);
      const scale = guide.scale ?? 1;
      if (scale !== 1) field = { ...field, data: field.data.map((v) => v * scale) };
      const thr = levels.map((l, i) => ({ id: l.id, min: guide.mins[i] }));
      const areas = contourField(field, thr, mask).flatMap((l) => l.rings.map((ring) => ({ riskLevel: l.id, ring })));
      onImport({ mode, day, areas });
      const pk = peakOf(field, mask);
      setStatus(`${(field.used || []).join(' + ')} · peak ${guide.fmt(pk)}`);
      toast.success(`${areas.length} area${areas.length === 1 ? '' : 's'} from the models, peak ${guide.fmt(pk)}`);
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
        <span className="sg-label">Day</span>
        <Seg value={day} onChange={setDay} color="#38bdf8" options={days.map((d) => [d, dayLabel(d)])} />
      </div>
      {guide.sources && (
        <div>
          <span className="sg-label">Model</span>
          <Seg value={source} onChange={setSource} color="#38bdf8" options={guide.sources} />
        </div>
      )}
      <div className="sg-row">
        <Btn primary color="#0ea5e9" icon={busy ? Loader2 : DownloadCloud} disabled={busy} onClick={() => run('replace')}>{busy ? 'Working…' : 'Build areas, replacing'}</Btn>
        <Btn disabled={busy} onClick={() => run('append')}>Add to areas</Btn>
      </div>
      {status && <span className="sg-status" style={{ '--c': busy ? '#facc15' : '#4ade80' }}><i />{status}</span>}
      <p className="sg-note">
        {view && !view.whole ? `Inside the ${view.label} view only. ` : ''}Levels follow this graphic's key ({levels.map((l, i) => `${l.short} ${guide.fmt(guide.mins[i])}`).join(', ')}). Picking a day moves the outlook day to it. A field the server has not built yet takes a minute or two the first time.
      </p>
    </div>
  );
}
