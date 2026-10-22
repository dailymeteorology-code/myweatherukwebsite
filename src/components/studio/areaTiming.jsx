/* When each risk area is active, and the shade of its outline, for the outlook graphics.

   Two areas of the same level can be live at different times (a SLGT in the west this morning,
   another in the east tonight). Each area can carry `from` / `to` (hour keys, 'YYYY-MM-DDTHH',
   like the timeline's marks) and `stroke`, a shade from white (0) to grey (1) for its outline in
   place of the level's own border. The timeline then draws a dashed ring in that shade round the
   stamps each timed area covers (tcm/StormOutlookTimelinePill), so the reader matches outline to
   time: white first, greyer later. Playback shows a timed area only during its own hours. */
import React from 'react';
import { Crosshair, X } from 'lucide-react';
import { Btn } from '@/components/studio/StudioUI';
import { keyMs, shiftKey, stampLabel } from '@/components/studio/studioTimeline';

const GREY = [107, 114, 128];
export const SHADES = [0, 0.25, 0.5, 0.75, 1];
export const shadeColor = (t) => {
  const c = (i) => Math.round(255 + (GREY[i] - 255) * Math.max(0, Math.min(1, t)));
  return `rgb(${c(0)},${c(1)},${c(2)})`;
};
const SHADE_NAMES = ['White', 'Light grey', 'Silver', 'Mid grey', 'Grey'];

export const isTimed = (s) => keyMs(s?.from) != null && keyMs(s?.to) != null;

/** Whether a timed area is live at ms (within `tol` of its hours); null for an untimed one. */
export function timedActive(s, ms, tol = 0) {
  if (!isTimed(s)) return null;
  return ms >= keyMs(s.from) - tol && ms <= keyMs(s.to) + tol;
}

/** An area's timing moved by whole days, with the outlook day. */
export const shiftTiming = (s, days) => (isTimed(s) && days ? { ...s, from: shiftKey(s.from, days), to: shiftKey(s.to, days) } : s);

/** The order of each timed area by its hours (1 = first), the same number for the same hours. */
export function timingOrder(shapes) {
  const spans = [...new Set(shapes.filter(isTimed).map((s) => `${keyMs(s.from)}|${keyMs(s.to)}`))]
    .map((k) => k.split('|').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([a, b]) => `${a}|${b}`);
  return shapes.map((s) => (isTimed(s) ? spans.indexOf(`${keyMs(s.from)}|${keyMs(s.to)}`) + 1 : 0));
}

/** Outline shades by time: the first white, the last grey, the rest evenly between. */
export function shadeByTiming(shapes) {
  const order = timingOrder(shapes), n = Math.max(0, ...order);
  if (!n) return shapes;
  return shapes.map((s, i) => (order[i] ? { ...s, stroke: n > 1 ? (order[i] - 1) / (n - 1) : 0 } : s));
}

/** The timeline's rings: one per distinct timed span and colour, on the stamps nearest its ends. */
export function timingRings(shapes, cells, colorOf, sel = null) {
  if (!cells.length) return [];
  const t0 = cells[0].ms, tN = cells[cells.length - 1].ms;
  const near = (t) => { let bi = 0, bd = Infinity; cells.forEach((c, i) => { const d = Math.abs(c.ms - t); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const out = new Map();
  shapes.forEach((s, i) => {
    if (!isTimed(s)) return;
    const f = keyMs(s.from), t = keyMs(s.to);
    if (t < t0 - 3600e3 || f > tN + 3600e3) return;   // wholly outside the window
    const color = colorOf(s);
    const a = near(f), b = Math.max(a, near(t)), key = `${a}|${b}|${color}`;
    const prev = out.get(key);
    out.set(key, { a, b, openA: f < t0, openB: t > tN, color, key, sel: (prev?.sel || false) || i === sel });
  });
  return [...out.values()];
}

/** The selected area's outline shade and hours. `picking`: the next two timeline clicks set them. */
export function AreaTimingPanel({ shape, cells, levelColor, onPatch, picking, onPicking, accent = '#a78bfa' }) {
  const timed = isTimed(shape);
  const opts = cells.map((c) => [c.at, stampLabel(c.ms)]);
  const withOwn = (k) => (k && !opts.some(([v]) => v === k) ? [[k, stampLabel(keyMs(k))], ...opts] : opts);
  const set = (end, k) => {
    if (!k) { onPatch({ from: null, to: null }); return; }
    let from = end === 'from' ? k : shape.from || k, to = end === 'to' ? k : shape.to || k;
    if (keyMs(to) < keyMs(from)) [from, to] = [to, from];
    onPatch({ from, to });
  };
  return (
    <>
      <div>
        <span className="sg-label">Outline</span>
        <div className="sg-row" style={{ gap: 5 }}>
          <button type="button" className="sg-swatch" aria-pressed={shape.stroke == null} title="The level's own border" aria-label="Level colour"
            style={{ background: levelColor }} onClick={() => onPatch({ stroke: null })} />
          {SHADES.map((t, i) => (
            <button key={t} type="button" className="sg-swatch" aria-pressed={shape.stroke === t} title={SHADE_NAMES[i]} aria-label={SHADE_NAMES[i]}
              style={{ background: shadeColor(t) }} onClick={() => onPatch({ stroke: t })} />
          ))}
          <input type="range" className="sg-range" min={0} max={100} step={1} value={Math.round((shape.stroke ?? 0) * 100)}
            onChange={(e) => onPatch({ stroke: Number(e.target.value) / 100 })} style={{ width: 90 }} title="Any shade between white and grey" aria-label="Outline shade" />
        </div>
      </div>
      <div>
        <span className="sg-label">Active</span>
        <div className="sg-grid2">
          <select className="sg-input" value={shape.from || ''} onChange={(e) => set('from', e.target.value)} aria-label="Active from">
            <option value="">All the time</option>
            {withOwn(shape.from).map(([v, l]) => <option key={v} value={v}>From {l}</option>)}
          </select>
          <select className="sg-input" value={shape.to || ''} onChange={(e) => set('to', e.target.value)} aria-label="Active until">
            <option value="">All the time</option>
            {withOwn(shape.to).map(([v, l]) => <option key={v} value={v}>Until {l}</option>)}
          </select>
        </div>
        <div className="sg-row" style={{ marginTop: 6 }}>
          <Btn sm on={picking} color={accent} icon={Crosshair} onClick={() => onPicking(!picking)}>{picking ? 'Click the first, then the last stamp…' : 'Pick on the timeline'}</Btn>
          {timed && <Btn sm icon={X} onClick={() => onPatch({ from: null, to: null })}>Not timed</Btn>}
        </div>
      </div>
    </>
  );
}
