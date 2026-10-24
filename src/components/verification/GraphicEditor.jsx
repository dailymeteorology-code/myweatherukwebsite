/* Adding a graphic to Forecast Verification (admins): upload the picture, say what period it
   forecast, and line its map up with the real coast, so the period's lightning can be drawn where it
   fell.

   Lining up: the coast and county lines of the UK & Ireland are drawn over the picture. Drag them
   onto the graphic's own coast, and zoom (the mouse wheel, a pinch or the buttons) until they match.
   A graphic from the Graphic Studio is Web Mercator, so moving and zooming are enough; "Stretch"
   adds separate width and height for a graphic drawn in another projection. The result is kept as
   the latitudes and longitudes of the picture's edges.

   Or import a thunderstorm outlook saved in the admin Graphic Studio (verification/studioImport): its
   areas are drawn on a map whose edges are known, so it needs no lining up, the period is its Valid
   span, and the areas are kept with the record so the page can score them against the lightning. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Loader2, Save, X, ZoomIn, ZoomOut, RotateCcw, MoveHorizontal, MoveVertical, ImagePlus, FolderOpen, DownloadCloud } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { loadLand, mercator, traceRings } from './landOutline';
import { drawStrikes, insideBounds, useFitted } from './GraphicOverlay';
import { fetchStrikes } from './novaMaps';
import { savedOutlooks, outlookPeriod, outlookAreas, renderOutlook, uploadPicture } from './studioImport';

const RAD = Math.PI / 180;
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2));
const unmerc = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD;
const MAX_SPAN_MS = 8 * 86400e3;

/* the picture's edges as a box in projected units (x = lon in radians, y = Mercator), top first */
const toBox = (b) => ({ x0: b.west * RAD, x1: b.east * RAD, y0: merc(b.north), y1: merc(b.south) });
const toBounds = (k) => ({ west: +(k.x0 / RAD).toFixed(5), east: +(k.x1 / RAD).toFixed(5), north: +unmerc(k.y0).toFixed(5), south: +unmerc(k.y1).toFixed(5) });
/** A first guess: the UK & Ireland in the middle of the picture, undistorted. */
function guessBox(w, h) {
  const X0 = -10.8 * RAD, X1 = 2.5 * RAD, Y0 = merc(61), Y1 = merc(49.5);
  const u = Math.max((X1 - X0) / w, (Y0 - Y1) / h) * 1.04;
  const cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2;
  return { x0: cx - (u * w) / 2, x1: cx + (u * w) / 2, y0: cy + (u * h) / 2, y1: cy - (u * h) / 2 };
}
/** Zoom by k (over 1 = the map grows) about the point (u, v) of the picture, on one or both axes. */
function zoom(k, u, v, f, axes = 'xy') {
  const out = { ...k };
  if (axes.includes('x')) { const s = (k.x1 - k.x0) / f, c = k.x0 + u * (k.x1 - k.x0); out.x0 = c - u * s; out.x1 = out.x0 + s; }
  if (axes.includes('y')) { const s = (k.y0 - k.y1) / f, c = k.y0 - v * (k.y0 - k.y1); out.y0 = c + v * s; out.y1 = out.y0 - s; }
  return out;
}
const pan = (k, du, dv) => ({ x0: k.x0 - du * (k.x1 - k.x0), x1: k.x1 - du * (k.x1 - k.x0), y0: k.y0 + dv * (k.y0 - k.y1), y1: k.y1 + dv * (k.y0 - k.y1) });

const localInput = (ms) => { const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const ukWhen = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '');
const savedWhen = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '');

function Stage({ image, box, setBox, stretch, strikes }) {
  const outer = useRef(null), wrap = useRef(null), cv = useRef(null), drag = useRef(null);
  const size = useFitted(outer, image.w, image.h, 78);
  const [land, setLand] = useState(null);
  useEffect(() => { loadLand().then(setLand).catch(() => {}); }, []);

  useEffect(() => {
    const draw = () => {
      const el = wrap.current, c = cv.current;
      if (!el || !c) return;
      const w = el.clientWidth, h = el.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const b = toBounds(box);
      if (land) {
        const P = mercator(b, w, h);
        ctx.lineJoin = 'round';
        for (const [rings, width] of [[land.context, 1], [land.counties, 1]]) {
          traceRings(ctx, rings, P, 0.6);
          ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = width + 2; ctx.stroke();
          ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = width; ctx.stroke();
        }
      }
      drawStrikes(ctx, strikes, b, w, h);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [box, land, strikes]);

  /* drag to move; two fingers to zoom */
  const pts = useRef(new Map());
  const onDown = (e) => {
    wrap.current.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, [e.clientX, e.clientY]);
    drag.current = { box, pts: new Map(pts.current) };
  };
  const onMove = (e) => {
    if (!pts.current.has(e.pointerId) || !drag.current) return;
    pts.current.set(e.pointerId, [e.clientX, e.clientY]);
    const r = wrap.current.getBoundingClientRect();
    const start = drag.current.pts, now = pts.current;
    if (now.size >= 2 && start.size >= 2) {
      const [a, b] = [...now.values()], [a0, b0] = [...start.values()];
      const f = Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1, Math.hypot(a0[0] - b0[0], a0[1] - b0[1]));
      const u = ((a0[0] + b0[0]) / 2 - r.left) / r.width, v = ((a0[1] + b0[1]) / 2 - r.top) / r.height;
      setBox(zoom(drag.current.box, u, v, f));
    } else {
      const s = start.get(e.pointerId);
      if (s) setBox(pan(drag.current.box, (e.clientX - s[0]) / r.width, (e.clientY - s[1]) / r.height));
    }
  };
  const onUp = (e) => { pts.current.delete(e.pointerId); drag.current = pts.current.size ? { box, pts: new Map(pts.current) } : null; };
  /* the wheel zooms about the pointer (a native listener, so the page does not scroll) */
  useEffect(() => {
    const el = wrap.current;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const f = Math.exp(-(e.deltaY || e.deltaX) * 0.0015);   // Shift+wheel arrives as deltaX
      setBox((k) => zoom(k, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, f, stretch && e.shiftKey ? 'x' : stretch && e.altKey ? 'y' : 'xy'));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setBox, stretch]);
  const onKey = (e) => {
    const step = e.shiftKey ? 0.02 : 0.004;
    const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (m) { e.preventDefault(); setBox((k) => pan(k, m[0], m[1])); }
  };

  return (
    <div ref={outer} className="fv-fit">
      <div ref={wrap} className="fv-stage" style={size ? { width: size[0], height: size[1] } : { aspectRatio: `${image.w} / ${image.h}` }} tabIndex={0}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}
        aria-label="Drag the outline onto the graphic's coast; the wheel zooms">
        <img src={image.url} alt="" draggable={false} />
        <canvas ref={cv} />
      </div>
    </div>
  );
}

export default function GraphicEditor({ item = null, onSaved, onCancel }) {
  const [image, setImage] = useState(item ? { url: item.image_url, w: item.image_w, h: item.image_h } : null);
  const [box, setBox] = useState(item ? toBox(item.bounds) : null);
  const [title, setTitle] = useState(item?.title || '');
  const [from, setFrom] = useState(localInput(item ? Date.parse(item.valid_from) : startOfToday()));
  const [to, setTo] = useState(localInput(item ? Date.parse(item.valid_to) : startOfToday() + 86400e3));
  const [notes, setNotes] = useState(item?.notes || '');
  const [stretch, setStretch] = useState(false);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [strikes, setStrikes] = useState(null);
  const [areas, setAreas] = useState(item?.areas || null);            // an imported outlook's areas, scored on the page
  const [source, setSource] = useState(item?.source_graphic || null); // and the saved graphic they came from
  const [studio, setStudio] = useState(null);                         // the studio's saved outlooks, once asked for
  const [pick, setPick] = useState('');
  const fileRef = useRef(null);

  const t0 = Date.parse(from), t1 = Date.parse(to);
  const spanErr = !(t1 > t0) ? 'The end must be after the start.' : t1 - t0 > MAX_SPAN_MS ? 'A period can be at most eight days.' : null;

  /* the period's lightning, to check the line-up against */
  useEffect(() => {
    setStrikes(null);
    if (spanErr) return undefined;
    let alive = true;
    const t = setTimeout(() => fetchStrikes(t0, Math.min(t1, Date.now())).then((s) => { if (alive) setStrikes(s.strikes); }).catch(() => { if (alive) setStrikes(null); }), 400);
    return () => { alive = false; clearTimeout(t); };
  }, [t0, t1, spanErr]);

  const upload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Choose a picture (JPG, PNG or WebP).'); return; }
    setErr(null); setBusy('Uploading…');
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const img = await new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = file_url; });
      setImage({ url: file_url, w: img.naturalWidth, h: img.naturalHeight });
      setBox(guessBox(img.naturalWidth, img.naturalHeight));
      setAreas(null); setSource(null);   // a picture of its own has no areas to score
      if (!title) setTitle(file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '));
    } catch (e) {
      setErr(`The upload failed (${e.message || e}).`);
    }
    setBusy(null);
  };

  const openStudio = async () => {
    setStudio('loading');
    try {
      const list = await savedOutlooks();
      setStudio(list);
      setPick(list[0]?.id || '');
    } catch (e) {
      setStudio(null);
      setErr(`The saved graphics could not be loaded (${e.message || e}).`);
    }
  };
  /* the saved outlook drawn on the map, its period and its areas */
  const importSaved = async () => {
    const g = Array.isArray(studio) && studio.find((x) => x.id === pick);
    if (!g) return;
    setErr(null); setBusy('Importing…');
    try {
      const s = g.graphic_tool_state;
      const [a, b] = outlookPeriod(s);
      const ar = outlookAreas(s);
      const pic = await renderOutlook({ areas: ar, periodLabel: `${ukWhen(a)} – ${ukWhen(b)}`, opacity: s.drawOpacity ?? 0.7 });
      const url = await uploadPicture(pic.blob, g.title || 'outlook');
      setImage({ url, w: pic.w, h: pic.h });
      setBox(toBox(pic.bounds));
      setAreas(ar);
      setSource({ id: g.id, title: g.title || '' });
      setTitle(g.title || 'Thunderstorm outlook');
      setFrom(localInput(a)); setTo(localInput(b));
    } catch (e) {
      setErr(`It could not be imported (${e.message || e}).`);
    }
    setBusy(null);
  };

  const inside = useMemo(() => (box && strikes ? insideBounds(strikes, toBounds(box)).length : null), [box, strikes]);

  const save = async () => {
    if (!image || !box) { setErr('Upload the graphic first.'); return; }
    if (spanErr) { setErr(spanErr); return; }
    setErr(null); setBusy('Saving…');
    const payload = {
      title: title.trim() || 'Forecast graphic', image_url: image.url, image_w: image.w, image_h: image.h,
      valid_from: new Date(t0).toISOString(), valid_to: new Date(t1).toISOString(), bounds: toBounds(box), notes: notes.trim(),
      strike_count: t1 <= Date.now() ? inside : null,
      areas: areas || null, source_graphic: areas ? source : null,
    };
    try {
      const saved = item ? await base44.entities.GraphicVerification.update(item.id, payload) : await base44.entities.GraphicVerification.create(payload);
      onSaved({ ...payload, ...saved });
    } catch (e) {
      setErr(`It could not be saved (${e.message || e}).`);
      setBusy(null);
    }
  };

  const zoomBy = (f, axes) => setBox((k) => zoom(k, 0.5, 0.5, f, axes));

  return (
    <section className="vf-glass vf-card" style={{ '--c': '#22d3ee' }}>
      <div className="vf-head"><ImagePlus /><h2>{item ? 'Edit graphic' : 'Add a graphic'}</h2><span className="vf-sp" />
        <button type="button" className="vf-btn" onClick={onCancel}><X />Cancel</button>
        <button type="button" className="vf-btn is-primary" onClick={save} disabled={!!busy || !image}>{busy === 'Saving…' ? <Loader2 className="vf-spin" /> : <Save />}Save</button>
      </div>
      <div className="fv-edit">
        <div className="fv-edit-form">
          <div>
            <span className="vf-label">From the Graphic Studio</span>
            {studio == null ? (
              <button type="button" className="vf-btn" onClick={openStudio} disabled={!!busy}><FolderOpen />Import a saved graphic</button>
            ) : studio === 'loading' ? (
              <p className="vf-note" style={{ margin: 0 }}><Loader2 className="vf-spin" /> Loading the saved graphics…</p>
            ) : studio.length === 0 ? (
              <p className="vf-note" style={{ margin: 0 }}>No thunderstorm outlook with areas has been saved in the Graphic Studio yet.</p>
            ) : (
              <div className="fv-tools" style={{ flexWrap: 'nowrap' }}>
                <select className="vf-input" value={pick} onChange={(e) => setPick(e.target.value)} style={{ minWidth: 0, flex: 1 }}>
                  {studio.map((g) => <option key={g.id} value={g.id}>{g.title || 'Untitled'}{/\b(saved|downloaded) \d/.test(g.title || '') ? '' : ` · saved ${savedWhen(g.created_date)}`}</option>)}
                </select>
                <button type="button" className="vf-btn is-primary" onClick={importSaved} disabled={!!busy || !pick}>{busy === 'Importing…' ? <Loader2 className="vf-spin" /> : <DownloadCloud />}Import</button>
              </div>
            )}
            <p className="vf-note" style={{ margin: '8px 0 0' }}>
              {areas
                ? <>Imported{source?.title ? <> from “{source.title}”</> : ''}: its {areas.length} area{areas.length === 1 ? '' : 's'} are drawn on the map, already lined up, and scored against the lightning. The period is its Valid time; change it below if you need to.</>
                : 'A thunderstorm outlook saved in Admin Settings → Graphic Studio comes in already lined up, with its period, and the page scores its areas against the lightning.'}
            </p>
          </div>
          <div>
            <span className="vf-label">{areas ? 'Picture' : 'Or a picture of a graphic'}</span>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
            <button type="button" className="fv-drop" onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files?.[0]); }} disabled={!!busy}>
              {busy === 'Uploading…' ? <Loader2 className="vf-spin" /> : <Upload />}
              <b>{image ? 'Replace the picture' : 'Upload a picture'}</b>
              <small>{image ? `${image.w} × ${image.h}` : 'Drop it here or click; JPG, PNG or WebP'}</small>
            </button>
          </div>
          <div><label className="vf-label" htmlFor="fv-title">Title</label><input id="fv-title" className="vf-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Thunderstorm outlook, Tuesday 21 October" /></div>
          <div className="fv-two">
            <div><label className="vf-label" htmlFor="fv-from">Valid from</label><input id="fv-from" type="datetime-local" className="vf-input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label className="vf-label" htmlFor="fv-to">Valid to</label><input id="fv-to" type="datetime-local" className="vf-input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
          {spanErr && <div className="vf-error">{spanErr}</div>}
          <div><label className="vf-label" htmlFor="fv-notes">Note (optional)</label><textarea id="fv-notes" className="vf-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How it went: where it worked, what it missed" /></div>
          {image && (
            <div className="fv-align">
              <span className="vf-label">Line up the map</span>
              <p className="vf-note" style={{ margin: '0 0 10px' }}>Drag the blue outline onto the graphic’s coast. Then hold the pointer over a place that matches and scroll: that place stays put while the rest grows or shrinks. Arrow keys nudge it (with Shift, further).</p>
              <div className="fv-tools">
                <button type="button" className="vf-btn" onClick={() => zoomBy(1.03)}><ZoomIn />Bigger</button>
                <button type="button" className="vf-btn" onClick={() => zoomBy(1 / 1.03)}><ZoomOut />Smaller</button>
                <button type="button" className="vf-btn" onClick={() => setBox(guessBox(image.w, image.h))}><RotateCcw />Start again</button>
                <button type="button" className={`vf-btn${stretch ? ' is-on' : ''}`} onClick={() => setStretch((s) => !s)} aria-pressed={stretch}>Stretch</button>
              </div>
              {stretch && (
                <div className="fv-tools" style={{ marginTop: 8 }}>
                  <button type="button" className="vf-btn" onClick={() => zoomBy(1 / 1.02, 'x')}><MoveHorizontal />Wider</button>
                  <button type="button" className="vf-btn" onClick={() => zoomBy(1.02, 'x')}><MoveHorizontal />Narrower</button>
                  <button type="button" className="vf-btn" onClick={() => zoomBy(1 / 1.02, 'y')}><MoveVertical />Taller</button>
                  <button type="button" className="vf-btn" onClick={() => zoomBy(1.02, 'y')}><MoveVertical />Shorter</button>
                  <p className="vf-note" style={{ margin: '4px 0 0', width: '100%' }}>For a graphic not drawn in Web Mercator. With the wheel, Shift changes only the width and Alt only the height.</p>
                </div>
              )}
              <p className="vf-note" style={{ margin: '10px 0 0' }}>
                {strikes == null ? 'Loading the period’s lightning…' : <><b>{(inside ?? 0).toLocaleString()}</b> strike{inside === 1 ? '' : 's'} on the graphic{t1 > Date.now() ? ' so far' : ''}.</>}
              </p>
            </div>
          )}
          {err && <div className="vf-error">{err}</div>}
        </div>
        <div className="fv-edit-stage">
          {image && box ? <Stage image={image} box={box} setBox={setBox} stretch={stretch} strikes={strikes} />
            : <div className="vf-empty" style={{ minHeight: 360 }}><ImagePlus /><b>Upload the graphic</b><p>Then line its map up with the coast here.</p></div>}
        </div>
      </div>
    </section>
  );
}
