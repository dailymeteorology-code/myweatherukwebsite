/* Forecast Verification: MyWeatherUK's forecast graphics with the lightning that followed drawn on
   top. An admin uploads a graphic, gives the period it forecast and lines its map up with the coast
   (verification/GraphicEditor); every visitor can then see where the lightning of that period fell
   on it, replay it hour by hour and download the result. Strikes come from the site's lightning
   archive (the Met Office over the UK & Ireland). Records are GraphicVerification entities: read by
   everyone, written by admins. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, Plus, Zap, Pencil, Trash2, Download, Play, Pause, ChevronLeft, ChevronRight, Loader2, ImagePlus, Clock, Target } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import VfPage, { Stat } from '@/components/verification/VfPage';
import GraphicOverlay, { insideBounds, drawStrikes } from '@/components/verification/GraphicOverlay';
import GraphicEditor from '@/components/verification/GraphicEditor';
import { fetchStrikes, london, hhmm } from '@/components/verification/novaMaps';
import { scoreAreas } from '@/components/verification/studioImport';

const CSS = `
.fv-top { display: flex; flex-direction: column; gap: 16px; scroll-margin-top: 80px; }
.fv-fit { width: 100%; display: flex; justify-content: center; }
.fv-pic, .fv-stage { position: relative; width: 100%; border-radius: 16px; overflow: hidden; background: var(--ad-surface3); box-shadow: 0 10px 30px -14px rgba(0,0,0,.55); }
.fv-pic img, .fv-stage img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; user-select: none; -webkit-user-drag: none; }
.fv-pic canvas, .fv-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.fv-stage { cursor: grab; touch-action: none; outline: none; }
.fv-stage:active { cursor: grabbing; }
.fv-stage:focus-visible { box-shadow: 0 0 0 3px color-mix(in srgb, #22d3ee 55%, transparent); }
.fv-edit { display: grid; grid-template-columns: minmax(280px, 380px) minmax(0, 1fr); gap: 18px; padding: 16px 18px 18px; }
.fv-edit-form { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.fv-edit-stage { min-width: 0; }
.fv-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.fv-drop { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 18px 12px; border-radius: 16px; font: inherit; cursor: pointer;
  color: var(--ad-text); background: var(--ad-surface3); border: 1.5px dashed var(--ad-border3); transition: border-color .15s, background .15s; }
.fv-drop:hover:not(:disabled) { border-color: #22d3ee; background: color-mix(in srgb, #22d3ee 8%, var(--ad-surface3)); }
.fv-drop svg { width: 22px; height: 22px; color: #22d3ee; }
.fv-drop small { color: var(--ad-text-dim); font-size: 12px; }
.fv-tools { display: flex; flex-wrap: wrap; gap: 6px; }
.fv-detail { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(300px, 1fr); gap: 18px; padding: 16px 18px 18px; align-items: start; }
.fv-info { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.fv-hist { display: flex; align-items: flex-end; gap: 2px; height: 78px; padding: 6px 0 0; }
.fv-hist i { flex: 1; min-width: 2px; border-radius: 3px 3px 0 0; background: var(--ad-border3); transition: background .15s; }
.fv-hist i.on { background: linear-gradient(180deg, #facc15, #f97316); }
.fv-axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--ad-text-dim); margin-top: 4px; }
.fv-replay { display: flex; align-items: center; gap: 8px; }
.fv-replay input { flex: 1; accent-color: #facc15; }
.fv-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; padding: 14px; }
.fv-card { display: flex; flex-direction: column; gap: 0; padding: 0; border-radius: 18px; overflow: hidden; cursor: pointer; font: inherit; text-align: left; color: var(--ad-text);
  background: var(--ad-surface3); border: 1px solid var(--ad-border); transition: border-color .15s, transform .15s; }
.fv-card:hover { transform: translateY(-1px); border-color: var(--ad-border3); }
.fv-card.on { border-color: var(--c); box-shadow: 0 0 0 1px var(--c); }
.fv-card .fv-pic { border-radius: 0; box-shadow: none; }
.fv-card > div:last-child { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 5px; }
.fv-card b { font-size: 13.5px; line-height: 1.3; }
.fv-card small { font-size: 12px; color: var(--ad-text-dim); }
.fv-swatches { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.fv-swatches button { width: 24px; height: 24px; padding: 0; border-radius: 50%; cursor: pointer; background: var(--sw); border: 2px solid var(--ad-border3);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.25); transition: transform .12s; }
.fv-swatches button:hover { transform: scale(1.1); }
.fv-swatches button.on { border-color: var(--ad-text); box-shadow: 0 0 0 2px color-mix(in srgb, var(--sw) 60%, transparent); }
.fv-swatches label { position: relative; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ad-text-dim); cursor: pointer; }
.fv-swatches input[type=color] { width: 30px; height: 26px; padding: 0; border: 1px solid var(--ad-border3); border-radius: 8px; background: none; cursor: pointer; }
@media (max-width: 1000px) { .fv-edit, .fv-detail { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 640px) { .fv-edit, .fv-detail { padding: 10px; } .fv-gallery { padding: 8px; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); } .fv-two { grid-template-columns: minmax(0, 1fr); } }
`;

const when = (iso) => `${london(iso, { weekday: 'short', day: 'numeric', month: 'short' })} ${hhmm(iso)}`;
const period = (it) => `${when(it.valid_from)} – ${london(it.valid_from, { day: 'numeric', month: 'short' }) === london(it.valid_to, { day: 'numeric', month: 'short' }) ? hhmm(it.valid_to) : when(it.valid_to)}`;
const span = (it) => [Date.parse(it.valid_from), Math.min(Date.parse(it.valid_to), Date.now())];

/* the strikes' colour: through the period, yellow, or any colour (ten to pick from, or the picker);
   remembered on this device */
const PRESETS = ['#ffffff', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#6366f1', '#3b82f6', '#22d3ee', '#22c55e', '#111827'];
const COLOUR_KEY = 'fv-strike-colour';
const readColour = () => { try { return { mode: 'time', custom: '#22d3ee', ...JSON.parse(localStorage.getItem(COLOUR_KEY) || '{}') }; } catch { return { mode: 'time', custom: '#22d3ee' }; } };
function useStrikeColour() {
  const [c, setC] = useState(readColour);
  const set = (patch) => setC((p) => { const n = { ...p, ...patch }; try { localStorage.setItem(COLOUR_KEY, JSON.stringify(n)); } catch { /* storage blocked */ } return n; });
  return [c, set];
}

/** The strikes on a graphic during its period, once `on`. */
function useGraphicStrikes(it, on = true) {
  const [s, setS] = useState(null);
  useEffect(() => {
    if (!on) return undefined;
    const [a, b] = span(it);
    if (!(b > a)) { setS([]); return undefined; }
    let alive = true;
    setS(null);
    fetchStrikes(a, b).then((r) => { if (alive) setS(insideBounds(r.strikes, it.bounds)); }).catch(() => { if (alive) setS([]); });
    return () => { alive = false; };
  }, [it.id, it.valid_from, it.valid_to, it.bounds, on]); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}

/* when the period's lightning came: one bar an hour (three hours past two days) */
function Histogram({ it, strikes, upTo }) {
  const [a, b] = [Date.parse(it.valid_from), Date.parse(it.valid_to)];
  const step = b - a > 48 * 3600e3 ? 3 * 3600e3 : 3600e3;
  const bins = useMemo(() => {
    const n = Math.max(1, Math.ceil((b - a) / step)), out = new Array(n).fill(0);
    for (const [t] of strikes || []) { const k = Math.floor((t - a) / step); if (k >= 0 && k < n) out[k] += 1; }
    return out;
  }, [strikes, a, b, step]);
  const max = Math.max(1, ...bins);
  return (
    <div>
      <span className="vf-label">When it came · {step === 3600e3 ? 'per hour' : 'per 3 hours'}</span>
      <div className="fv-hist">
        {bins.map((n, k) => <i key={k} className={a + k * step <= upTo ? 'on' : ''} style={{ height: `${n ? Math.max(4, (n / max) * 100) : 1.5}%` }} title={`${hhmm(new Date(a + k * step).toISOString())}: ${n} strike${n === 1 ? '' : 's'}`} />)}
      </div>
      <div className="fv-axis"><span>{when(it.valid_from)}</span><span>{when(it.valid_to)}</span></div>
    </div>
  );
}

/* the graphic with its lightning, made at the picture's own size */
async function download(it, strikes, byTime, dot, color) {
  const img = await new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = it.image_url; });
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  drawStrikes(ctx, strikes, it.bounds, w, h, { byTime, dot, color });
  const pad = Math.round(w * 0.018), fs = Math.round(w * 0.019);
  ctx.font = `700 ${fs}px -apple-system, 'Segoe UI', Roboto, sans-serif`;
  const label = `⚡ ${strikes.length.toLocaleString()} strikes · ${period(it)} · Met Office lightning`;
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(8,12,22,0.72)';
  ctx.beginPath(); ctx.roundRect(pad, pad, tw + fs * 1.4, fs * 2.1, fs * 0.6); ctx.fill();
  ctx.fillStyle = '#fef9c3';
  ctx.fillText(label, pad + fs * 0.7, pad + fs * 1.42);
  const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/jpeg', 0.92));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `verification-${(it.title || 'graphic').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.jpg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function Detail({ it, admin, onEdit, onDelete, onCount, prev, next, go }) {
  const strikes = useGraphicStrikes(it);
  const [show, setShow] = useState(true);
  const [colour, setColour] = useStrikeColour();
  const byTime = colour.mode === 'time', color = colour.mode === 'custom' ? colour.custom : '#facc15';
  /* an imported outlook's areas against the lightning (studioImport.scoreAreas) */
  const score = useMemo(() => (it.areas ? scoreAreas(it.areas, strikes) : null), [it.areas, strikes]);
  const [dot, setDot] = useState(1);
  const [upTo, setUpTo] = useState(Infinity);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [a, b] = [Date.parse(it.valid_from), Date.parse(it.valid_to)];
  const ended = b <= Date.now();

  useEffect(() => {
    if (!playing) return undefined;
    const stepMs = (b - a) / 120;
    const t = setInterval(() => setUpTo((u) => { const nu = (u === Infinity ? a : u) + stepMs; return nu >= b ? Infinity : nu; }), 70);
    return () => clearInterval(t);
  }, [playing, a, b]);
  useEffect(() => { if (playing && upTo === Infinity) setPlaying(false); }, [playing, upTo]);
  /* a finished period's count is kept with the graphic (for the totals at the top) */
  useEffect(() => {
    if (admin && ended && strikes && it.strike_count !== strikes.length) {
      base44.entities.GraphicVerification.update(it.id, { strike_count: strikes.length }).then(() => onCount(strikes.length)).catch(() => {});
    }
  }, [admin, ended, strikes]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = upTo === Infinity ? strikes?.length : strikes?.filter(([t]) => t <= upTo).length;
  return (
    <section className="vf-glass vf-card">
      <div className="vf-head"><BarChart3 /><h2>{it.title || 'Forecast graphic'}</h2><small>{period(it)}</small><span className="vf-sp" />
        <button type="button" className="vf-btn is-icon" disabled={!prev} onClick={() => go(prev)} aria-label="Older graphic"><ChevronLeft /></button>
        <button type="button" className="vf-btn is-icon" disabled={!next} onClick={() => go(next)} aria-label="Newer graphic"><ChevronRight /></button>
      </div>
      <div className="fv-detail">
        <GraphicOverlay item={it} strikes={strikes} show={show} upTo={upTo} byTime={byTime} dot={dot} color={color} maxVh={80} />
        <div className="fv-info">
          <div className="vf-stats" style={{ marginTop: 0, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <Stat label="Strikes on the graphic" value={strikes ? (shown ?? 0).toLocaleString() : '…'} note={upTo === Infinity ? (ended ? 'over the whole period' : 'so far; the period is still going') : `up to ${when(new Date(upTo).toISOString())}`} />
            <Stat label="Period" value={`${Math.round((b - a) / 3600e3)} h`} note={ended ? 'finished' : 'still going'} />
          </div>
          {it.areas && (
            <div className="vf-stats" style={{ marginTop: 0, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              <Stat label="Accuracy" value={score ? `${score.score}%` : strikes ? '–' : '…'} note={score ? (ended ? 'of the whole period' : 'so far') : strikes ? 'no lightning on the map yet' : ''} />
              <Stat label="Strikes in risk areas" value={score ? `${score.pod}%` : '–'} note={score ? `${score.caught.toLocaleString()} of ${score.total.toLocaleString()}` : ''} />
              <Stat label="Areas with lightning" value={score ? `${score.areasHit} / ${score.areas}` : '–'} note={score?.later ? `${score.later} not begun yet` : 'risk areas that saw a strike'} />
            </div>
          )}
          {strikes === null ? <div className="vf-skel" style={{ height: 110 }} /> : <Histogram it={it} strikes={strikes} upTo={upTo} />}
          <div className="fv-replay">
            <button type="button" className="vf-btn is-icon" onClick={() => { if (!playing && upTo === Infinity) setUpTo(a); setPlaying((p) => !p); }} aria-label={playing ? 'Pause' : 'Replay the lightning'} disabled={!strikes?.length}>{playing ? <Pause /> : <Play />}</button>
            <input type="range" min={a} max={b} step={(b - a) / 240} value={upTo === Infinity ? b : upTo} onChange={(e) => { setPlaying(false); const v = Number(e.target.value); setUpTo(v >= b ? Infinity : v); }} aria-label="Show the lightning up to" />
            <span className="vf-chip"><Clock />{upTo === Infinity ? 'All' : hhmm(new Date(upTo).toISOString())}</span>
          </div>
          <div className="fv-tools">
            <button type="button" className={`vf-btn${show ? ' is-on' : ''}`} style={{ '--c': '#facc15' }} onClick={() => setShow((s) => !s)} aria-pressed={show}><Zap />Strikes</button>
            <div className="vf-seg" aria-label="Strike colour">
              <button type="button" className={colour.mode === 'time' ? 'on' : ''} onClick={() => setColour({ mode: 'time' })}>By time</button>
              <button type="button" className={colour.mode === 'yellow' ? 'on' : ''} onClick={() => setColour({ mode: 'yellow' })}>Yellow</button>
              <button type="button" className={colour.mode === 'custom' ? 'on' : ''} onClick={() => setColour({ mode: 'custom' })}>
                <i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', marginRight: 5, background: colour.custom, boxShadow: '0 0 0 1px rgba(0,0,0,.3)' }} />Custom
              </button>
            </div>
            <div className="vf-seg" aria-label="Dot size">
              {[[0.7, 'S'], [1, 'M'], [1.5, 'L']].map(([v, l]) => <button key={l} type="button" className={dot === v ? 'on' : ''} onClick={() => setDot(v)}>{l}</button>)}
            </div>
          </div>
          {colour.mode === 'custom' && (
            <div className="fv-swatches" role="group" aria-label="Strike colour">
              {PRESETS.map((c) => <button key={c} type="button" className={colour.custom === c ? 'on' : ''} style={{ '--sw': c }} onClick={() => setColour({ custom: c })} aria-label={c} title={c} />)}
              <label title="Any colour">
                <input type="color" value={colour.custom} onChange={(e) => setColour({ custom: e.target.value })} />Any colour
              </label>
            </div>
          )}
          {it.areas && <p className="vf-note" style={{ margin: 0 }}><Target style={{ width: 13, height: 13, verticalAlign: -2, marginRight: 4 }} />Accuracy: the share of strikes that fell inside a risk area (at that area’s own hours, give or take an hour, when it has them) and the share of the risk areas that saw lightning, taken together so it is high only when the areas both caught the lightning and were not drawn where none fell. Severe areas are overlays and are not scored on their own.</p>}
          {byTime && show && <div className="vf-legend"><span><i style={{ background: 'linear-gradient(90deg,#dc2626,#f97316,#facc15,#fffbe6)' }} />strikes, earliest to latest in the period</span></div>}
          {it.notes && <div className="vf-note" style={{ whiteSpace: 'pre-wrap' }}>{it.notes}</div>}
          <div className="fv-tools">
            <button type="button" className="vf-btn" disabled={!strikes || busy} onClick={async () => { setBusy(true); try { await download(it, strikes, byTime, dot, color); } finally { setBusy(false); } }}>{busy ? <Loader2 className="vf-spin" /> : <Download />}Download</button>
            {admin && <button type="button" className="vf-btn" onClick={onEdit}><Pencil />Edit</button>}
            {admin && <button type="button" className="vf-btn is-danger" onClick={onDelete}><Trash2 />Delete</button>}
          </div>
          <p className="vf-note" style={{ margin: 0 }}>Lightning recorded by the Met Office over the UK &amp; Ireland during the graphic’s period, placed on its map.</p>
        </div>
      </div>
    </section>
  );
}

function Card({ it, on, onPick }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  const strikes = useGraphicStrikes(it, seen);
  const score = useMemo(() => (it.areas ? scoreAreas(it.areas, strikes) : null), [it.areas, strikes]);
  return (
    <button ref={ref} type="button" className={`fv-card${on ? ' on' : ''}`} onClick={onPick}>
      <GraphicOverlay item={it} strikes={strikes} lazy />
      <div>
        <b>{it.title || 'Forecast graphic'}</b>
        <small>{period(it)}</small>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          <span className="vf-chip" style={{ '--k': '#facc15' }}><Zap />{strikes ? `${strikes.length.toLocaleString()} strike${strikes.length === 1 ? '' : 's'}` : '…'}</span>
          {score && <span className="vf-chip" style={{ '--k': '#22d3ee' }}><Target />{score.score}% accurate</span>}
        </span>
      </div>
    </button>
  );
}

export default function ForecastVerification() {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);
  const top = useRef(null);

  useEffect(() => {
    base44.entities.GraphicVerification.list('-valid_from', 500)
      .then((r) => setItems((r || []).filter((x) => x.image_url && x.bounds && x.valid_from && x.valid_to)))
      .catch(() => setErr('The graphics could not be loaded.'));
  }, []);

  const sorted = useMemo(() => [...(items || [])].sort((x, y) => y.valid_from.localeCompare(x.valid_from)), [items]);
  const id = params.get('id');
  const current = sorted.find((x) => x.id === id) || sorted[0] || null;
  const i = current ? sorted.indexOf(current) : -1;
  const go = (x, scroll = false) => {
    setParams((p) => { const n = new URLSearchParams(p); n.set('id', x); return n; }, { replace: true });
    if (scroll) top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const saved = (it) => {
    setItems((list) => [...(list || []).filter((x) => x.id !== it.id), it]);
    setEditing(null);
    go(it.id, true);
  };
  const remove = async (it) => {
    if (!window.confirm(`Delete “${it.title || 'this graphic'}” from Forecast Verification?`)) return;
    try {
      await base44.entities.GraphicVerification.delete(it.id);
      setItems((list) => list.filter((x) => x.id !== it.id));
      setParams((p) => { const n = new URLSearchParams(p); n.delete('id'); return n; }, { replace: true });
    } catch (e) {
      setErr(`It could not be deleted (${e.message || e}).`);
    }
  };

  const total = sorted.reduce((s, x) => s + (Number.isFinite(x.strike_count) ? x.strike_count : 0), 0);
  const hero = (
    <>
      {sorted.length > 0 && (
        <div className="vf-stats">
          <Stat label="Graphics checked" value={sorted.length} note={`newest ${london(sorted[0].valid_from, { day: 'numeric', month: 'short', year: 'numeric' })}`} />
          <Stat label="Strikes" value={total.toLocaleString()} note="on the finished ones" />
        </div>
      )}
      {admin && !editing && (
        <div style={{ marginTop: 16 }}>
          <button type="button" className="vf-btn is-primary" style={{ '--c': '#22d3ee' }} onClick={() => { setEditing('new'); setTimeout(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}><Plus />Add a graphic</button>
        </div>
      )}
    </>
  );

  return (
    <VfPage title="Forecast Verification" accent="#22d3ee" accent2="#a78bfa" css={CSS} hero={hero}
      lede="Our forecast graphics with the lightning that followed drawn on top: every strike the Met Office recorded during the period, where it fell on the map. Replay it through the period, or download it.">
      {err && <div className="vf-error">{err}</div>}
      {(editing || current) && (
        <div ref={top} className="fv-top">
          {editing && <GraphicEditor item={editing === 'new' ? null : editing} onSaved={saved} onCancel={() => setEditing(null)} />}
          {current && !editing && (
            <Detail key={current.id} it={current} admin={admin} onEdit={() => setEditing(current)} onDelete={() => remove(current)}
              onCount={(n) => setItems((list) => list.map((x) => (x.id === current.id ? { ...x, strike_count: n } : x)))}
              prev={sorted[i + 1]?.id} next={i > 0 ? sorted[i - 1].id : null} go={(x) => go(x)} />
          )}
        </div>
      )}
      {items === null && !err && <div className="vf-skel" style={{ height: 420, borderRadius: 24 }} />}
      {items && sorted.length === 0 && !editing && (
        <section className="vf-glass vf-card"><div className="vf-empty"><ImagePlus /><b>No graphics checked yet</b>
          <p>{admin ? 'Add a forecast graphic and line its map up; the lightning of its period is drawn over it.' : 'Forecast graphics appear here with the lightning that followed drawn over them.'}</p>
        </div></section>
      )}
      {sorted.length > 1 && (
        <section className="vf-glass vf-card">
          <div className="vf-head"><BarChart3 /><h2>Every graphic</h2><small>{sorted.length}, newest first</small></div>
          <div className="fv-gallery">
            {sorted.map((x) => <Card key={x.id} it={x} on={x.id === current?.id} onPick={() => { setEditing(null); go(x.id, true); }} />)}
          </div>
        </section>
      )}
    </VfPage>
  );
}
