/* ════════════════════════════════════════════════════════════════════════════
   The TCM tab on a phone (17 Nov 2026, at the user's request: "make the TCM page significantly more mobile friendly
   and much easier to navigate; the map should be the centre of the whole thing; you shouldn't need to scroll ...
   unlock TCM NOVA for all users ... liquid glass and apple like, something like the Model Data page ... the globe
   removed, UK only ... the load time as fast as possible"; then "load onto TCM NOVA, the high resolution and the
   stroke one, download the chart, the highest risk point with a star, and the day and time selection much better
   and smoother").

   The map fills the screen. "TCM" is written on it with what is on show under it, a glass switch picks TCM NOVA (to
   start with) or TCM V3, and two glass buttons: Download (the chart as a picture) and Layers (the hazard, the style
   - the outlook's levels with their strokes, or high resolution - and the star on the highest risk). The days are a
   glass strip with a lens that slides between them; NOVA's hours are a slider under them. Each model is one small
   download (lib/tcmApp.js); every field and picture is kept once made, so going back to one is instant.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Layers, X, Loader2, Lock, Download, Star, Check } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import { useSectionActive } from '@/components/app/sectionActive';
import { LEVELS, V3_STARTS, NOVA_STARTS, V3_HAZARDS, NOVA_HAZARDS, STYLES, levelOf, loadV3, loadNova, novaField, novaAt, novaPicture } from '@/lib/tcmApp';
import './tcm-screen.css';
import '@/components/app/liquid-glass.css';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const BASEMAP = {
  dark: [`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
  light: [`${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
};
const UK = [[49.9, -10.6], [59.0, 2.0]];
const TZ = 'Europe/London';
/* 'Today', 'Tmrw' or the weekday, by the UK's calendar (a run's first day can be yesterday) */
const dayWord = (dateStr) => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('en-CA', { timeZone: TZ });
  if (dateStr === today) return 'Today';
  if (dateStr === tomorrow) return 'Tmrw';
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short' });
};
const dayLong = (dateStr) => new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const hourOf = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const runWords = (iso) => (iso ? `${new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit' })}Z run` : '');
const PREF = 'mwuk_tcm_app';
const readPref = () => { try { return JSON.parse(localStorage.getItem(PREF) || '{}') || {}; } catch { return {}; } };

export default function TCMScreen() {
  const { isDark } = useTheme();
  const active = useSectionActive();
  const pref = useMemo(readPref, []);
  /* TCM NOVA to start with, every time (17 Nov 2026, at the user's request) */
  const [engine, setEngine] = useState('nova');
  const [v3Hazard, setV3Hazard] = useState(pref.v3Hazard || 'thunderstorm');
  const [novaHazard, setNovaHazard] = useState(pref.novaHazard || 'p_thunder');
  const [style, setStyle] = useState(pref.style === 'hires' ? 'hires' : 'outlook');
  const [starOn, setStarOn] = useState(!!pref.star);
  const [layersOpen, setLayersOpen] = useState(false);
  const [dayIdx, setDayIdx] = useState(0);
  const [lead, setLead] = useState(null);                // NOVA: a 3-hourly frame, or null for the whole day
  const [v3, setV3] = useState(null);
  const [nova, setNova] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(null);              // what is on the map: { key, max, data, grid }
  const [probe, setProbe] = useState(null);              // a tap: { lat, lon }
  const [saving, setSaving] = useState(false);
  useEffect(() => { try { localStorage.setItem(PREF, JSON.stringify({ v3Hazard, novaHazard, style, star: starOn })); } catch { /* blocked */ } }, [v3Hazard, novaHazard, style, starOn]);

  const rootRef = useRef(null), mapEl = useRef(null), mapRef = useRef(null), overlay = useRef(null);
  /* the screen's height: all of it below whatever sits above, measured while on show */
  const [topOffset, setTopOffset] = useState(0);
  useEffect(() => {
    const measure = () => { const el = rootRef.current; if (el && !el.closest('[data-off]')) setTopOffset(Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY))); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [active]);

  /* the map, made once */
  useEffect(() => {
    const el = mapEl.current;
    const m = L.map(el, { zoomControl: false, attributionControl: true, minZoom: 5, maxZoom: 10, zoomSnap: 0.25 });
    m.attributionControl.setPrefix(false);
    m.createPane('labels'); m.getPane('labels').style.zIndex = 650; m.getPane('labels').style.pointerEvents = 'none';
    overlay.current = L.imageOverlay('data:image/gif;base64,R0lGODlhAQABAAAAACw=', UK, { opacity: 0, interactive: false, className: 'tc-field' }).addTo(m);
    mapRef.current = m;
    const frame = () => {
      const r = rootRef.current?.getBoundingClientRect();
      const head = rootRef.current?.querySelector('.tc-engine')?.getBoundingClientRect();
      const dock = rootRef.current?.querySelector('.tc-dock')?.getBoundingClientRect();
      try { m.fitBounds(UK, { animate: false, paddingTopLeft: [4, r && head ? head.bottom - r.top + 2 : 120], paddingBottomRight: [4, r && dock ? r.bottom - dock.top + 4 : 160] }); } catch { /* not laid out */ }
    };
    let moved = false;
    const mine = () => { moved = true; };
    ['mousedown', 'touchstart', 'wheel'].forEach((ev) => el.addEventListener(ev, mine, { passive: true }));
    const ro = new ResizeObserver(() => { m.invalidateSize({ animate: false }); if (!moved) frame(); });
    ro.observe(el);
    requestAnimationFrame(frame);
    m.on('click', (e) => setProbe({ lat: e.latlng.lat, lon: e.latlng.lng }));
    return () => { ro.disconnect(); ['mousedown', 'touchstart', 'wheel'].forEach((ev) => el.removeEventListener(ev, mine)); m.remove(); mapRef.current = null; };
  }, []);
  /* the base map (its tiles open to a picture: the downloaded chart draws them) */
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return undefined;
    const [base, labels] = BASEMAP[isDark ? 'dark' : 'light'];
    const t = [
      L.tileLayer(base, { attribution: '© Esri · TCM © MyWeatherUK', crossOrigin: 'anonymous' }).addTo(m),
      L.tileLayer(labels, { pane: 'labels', crossOrigin: 'anonymous' }).addTo(m),
    ];
    return () => t.forEach((x) => x.remove());
  }, [isDark]);

  /* the models: each read once when first wanted, and again every ten minutes while the tab is on show */
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') setRound((r) => r + 1); }, 10 * 60e3);
    return () => clearInterval(t);
  }, [active]);
  useEffect(() => {
    if (engine !== 'v3' || (v3 && round === v3.round)) return undefined;
    let alive = true;
    loadV3().then((d) => { if (alive) { setV3({ ...d, round }); setErr((e) => ({ ...e, v3: null })); } })
      .catch((e) => { if (alive) setErr((x) => ({ ...x, v3: e.message || 'TCM V3 could not be read' })); });
    return () => { alive = false; };
  }, [engine, round]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (engine !== 'nova' || (nova && round === nova.round)) return undefined;
    let alive = true;
    loadNova('main').then((m) => { if (alive) { setNova({ ...m, round }); setErr((e) => ({ ...e, nova: null })); } })
      .catch((e) => { if (alive) setErr((x) => ({ ...x, nova: e.locked ? 'locked' : (e.message || 'TCM NOVA could not be read') })); });
    return () => { alive = false; };
  }, [engine, round]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the days on offer, and NOVA's hours in the day on show */
  const days = engine === 'v3'
    ? (v3?.days || []).map((d) => ({ key: d.date, label: dayWord(d.date), date: d.date }))
    : (nova?.days || []).map((d) => ({ key: d.date, label: dayWord(d.date), date: d.date, lead: d.lead_min || [], fields: d.fields || [] }));
  const dayI = Math.min(dayIdx, Math.max(0, days.length - 1));
  const day = days[dayI];
  const hours = engine === 'nova' && day ? day.lead.map((lm) => ({ lead: lm, valid: nova.frames.find((x) => x.lead_min === lm)?.valid })).filter((h) => h.valid) : [];
  const allDay = engine === 'nova' && !!day?.fields?.includes(novaHazard);
  useEffect(() => { setLead(null); }, [engine, dayIdx]);
  /* NOVA: with no whole-day summary for this hazard, the day's first hour */
  const leadNow = engine === 'nova' && day ? (lead ?? (allDay ? null : hours[0]?.lead ?? 0)) : null;

  /* the picture on the map: kept once made (key: everything it depends on) */
  const pics = useRef(new Map()), fields = useRef(new Map());
  const picKey = !day ? null : engine === 'v3'
    ? (v3 ? `v3|${v3.run}|${dayI}|${v3Hazard}|${style}` : null)
    : (nova ? `nova|${nova.run_id}|${day.date}|${leadNow ?? 'day'}|${novaHazard}|${style}` : null);
  useEffect(() => {
    const ov = overlay.current;
    if (!ov || !picKey) return undefined;
    let alive = true;
    const show = (pic) => {
      ov.setBounds(L.latLngBounds(pic.box));
      if (ov._url === pic.url) { ov.setOpacity(0.88); }
      else { ov.once('load', () => { if (alive) ov.setOpacity(0.88); }); ov.setUrl(pic.url); }
      setShown({ key: picKey, max: pic.max, data: pic.data || null, grid: pic.grid || null });
    };
    const kept = pics.current.get(picKey);
    if (kept) { show(kept); return undefined; }
    setBusy(true);
    (async () => {
      try {
        let pic;
        if (engine === 'v3') pic = await v3.picture(dayI, v3Hazard, style);
        else {
          const fk = `${nova.run_id}|${novaHazard}|${leadNow == null ? `day:${day.date}` : `lead:${leadNow}`}`;
          let data = fields.current.get(fk);
          if (!data) { data = await novaField('main', nova.run_id, novaHazard, leadNow == null ? { day: day.date } : { lead: leadNow }); fields.current.set(fk, data); }
          pic = { ...(await novaPicture(data, nova.grid, style)), data, grid: nova.grid };
        }
        if (!alive) return;
        pics.current.set(picKey, pic);
        show(pic);
      } catch (e) {
        if (alive) setErr((x) => ({ ...x, [engine]: e.message || 'The map could not be drawn' }));
      } finally { if (alive) setBusy(false); }
    })();
    return () => { alive = false; };
  }, [picKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /* a model not loaded yet shows nothing of the other's */
  useEffect(() => { if (!picKey) overlay.current?.setOpacity(0); }, [picKey]);

  /* the star on the highest risk */
  const starMarker = useRef(null);
  useEffect(() => {
    const m = mapRef.current;
    if (starMarker.current) { starMarker.current.remove(); starMarker.current = null; }
    const mx = shown?.max;
    if (!m || !starOn || !mx || !(mx.v > 0)) return;
    const val = engine === 'v3' ? `${Math.round(mx.v)}/100` : `${Math.round(mx.v * 100)}%`;
    starMarker.current = L.marker([mx.lat, mx.lon], {
      icon: L.divIcon({ className: 'tc-star', iconSize: [0, 0], html: `<span><svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" fill="#ffd60a" stroke="#1c1300" stroke-width="1.4" stroke-linejoin="round"/></svg><b>${val}</b></span>` }),
      interactive: false, keyboard: false, zIndexOffset: 2000,
    }).addTo(m);
  }, [shown, starOn, engine]);

  /* a tap: the level there */
  useEffect(() => { setProbe(null); }, [engine, v3Hazard, novaHazard]);
  const probeText = (() => {
    if (!probe) return null;
    if (engine === 'v3' && v3) {
      const v = v3.at(probe.lat, probe.lon, dayI, v3Hazard);
      const q = levelOf(v, V3_STARTS);
      return { level: q, text: q >= 0 ? `${LEVELS[q].name} (${LEVELS[q].code})` : 'No risk', value: `${Math.round(v)}/100` };
    }
    if (engine === 'nova' && shown?.data) {
      const v = novaAt(shown.data, shown.grid, probe.lat, probe.lon);
      if (!Number.isFinite(v)) return { level: -1, text: 'Outside NOVA', value: '' };
      const q = levelOf(v, NOVA_STARTS);
      return { level: q, text: q >= 0 ? `${LEVELS[q].name} (${LEVELS[q].code})` : 'No risk', value: `${Math.round(v * 100)}%` };
    }
    return null;
  })();
  const probeMarker = useRef(null);
  useEffect(() => {
    const m = mapRef.current;
    if (probeMarker.current) { probeMarker.current.remove(); probeMarker.current = null; }
    if (!m || !probe) return;
    probeMarker.current = L.marker([probe.lat, probe.lon], { icon: L.divIcon({ className: 'tc-pin', iconSize: [16, 16], html: '<i></i>' }), interactive: false, keyboard: false }).addTo(m);
  }, [probe]);

  const hazards = engine === 'v3' ? V3_HAZARDS : NOVA_HAZARDS;
  const hazard = engine === 'v3' ? v3Hazard : novaHazard;
  const hazardName = hazards.find((h) => h.id === hazard)?.name || '';
  const whenText = !day ? '' : `${dayLong(day.date)}${engine === 'nova' ? (leadNow == null ? ', all day' : `, ${hourOf(hours.find((h) => h.lead === leadNow)?.valid || nova.frames[0].valid)}`) : ''}`;
  const sub = engine === 'v3'
    ? (v3 ? `${hazardName} · ${runWords(v3.run)}` : 'TCM V3')
    : (nova ? `${hazardName} · ${runWords(nova.init_utc)}` : 'TCM NOVA');
  const error = err[engine];
  const loading = engine === 'v3' ? !v3 && !error : !nova && !error;

  /* ── the chart as a picture: the map as it is on screen, the field, the place names, a title and the key ── */
  const downloadChart = async () => {
    const box = mapEl.current?.getBoundingClientRect();
    if (!box || saving) return;
    setSaving(true);
    try {
      const S = Math.min(2, window.devicePixelRatio || 1), W = Math.round(box.width * S), H = Math.round(box.height * S);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = isDark ? '#222327' : '#d0cfd3'; ctx.fillRect(0, 0, W, H);
      const draw = (img, alpha = 1) => {
        if (!img.complete || !img.naturalWidth) return;
        const r = img.getBoundingClientRect();
        ctx.globalAlpha = alpha * (Number(getComputedStyle(img).opacity) || 1);
        try { ctx.drawImage(img, (r.left - box.left) * S, (r.top - box.top) * S, r.width * S, r.height * S); } catch { /* not drawable */ }
        ctx.globalAlpha = 1;
      };
      mapEl.current.querySelectorAll('.leaflet-tile-pane img.leaflet-tile').forEach((i) => draw(i));
      mapEl.current.querySelectorAll('.leaflet-overlay-pane img.tc-field').forEach((i) => draw(i));
      mapEl.current.querySelectorAll('.leaflet-labels-pane img.leaflet-tile').forEach((i) => draw(i));
      /* the title along the top, on a fade, and the key along the foot */
      const ink = isDark ? '#fff' : '#0b1220', air = isDark ? '6,10,20' : '236,242,249';
      let g = ctx.createLinearGradient(0, 0, 0, 120 * S);
      g.addColorStop(0, `rgba(${air},0.92)`); g.addColorStop(1, `rgba(${air},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, 120 * S);
      ctx.fillStyle = ink; ctx.font = `800 ${26 * S}px -apple-system, BlinkMacSystemFont, Inter, sans-serif`;
      ctx.fillText(engine === 'v3' ? 'TCM V3' : 'TCM NOVA', 16 * S, 40 * S);
      ctx.font = `600 ${14 * S}px -apple-system, BlinkMacSystemFont, Inter, sans-serif`;
      ctx.fillText(`${hazardName} · ${whenText}`, 16 * S, 62 * S);
      ctx.globalAlpha = 0.7; ctx.fillText(`${engine === 'v3' ? runWords(v3?.run) : runWords(nova?.init_utc)} · MyWeatherUK`, 16 * S, 82 * S); ctx.globalAlpha = 1;
      g = ctx.createLinearGradient(0, H - 70 * S, 0, H);
      g.addColorStop(0, `rgba(${air},0)`); g.addColorStop(1, `rgba(${air},0.9)`);
      ctx.fillStyle = g; ctx.fillRect(0, H - 70 * S, W, 70 * S);
      let x = 16 * S;
      ctx.font = `700 ${12 * S}px -apple-system, BlinkMacSystemFont, Inter, sans-serif`;
      for (const l of LEVELS) {
        ctx.fillStyle = `rgb(${l.rgb.join(',')})`; ctx.fillRect(x, H - 30 * S, 18 * S, 10 * S);
        ctx.fillStyle = ink; ctx.fillText(l.code, x + 22 * S, H - 21 * S);
        x += (30 + ctx.measureText(l.code).width / S) * S;
      }
      const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
      if (!blob) throw new Error('The chart could not be made');
      const name = `tcm-${engine}-${hazard}-${day?.date || 'chart'}.png`;
      const file = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `${engine === 'v3' ? 'TCM V3' : 'TCM NOVA'}: ${hazardName}` }).catch(() => {});
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    } catch (e) {
      setErr((x) => ({ ...x, [engine]: e.message || 'The chart could not be made' }));
    } finally { setSaving(false); }
  };

  /* ── the hours: a slider you can drag, one step a frame ── */
  const track = useRef(null), scrub = useRef(null);
  const hourIdx = leadNow == null ? -1 : hours.findIndex((h) => h.lead === leadNow);
  const pickHour = (x) => {
    const r = track.current.getBoundingClientRect(), n = hours.length;
    if (!n) return;
    const i = Math.max(0, Math.min(n - 1, Math.round(((x - r.left) / r.width) * (n - 1))));
    setLead(hours[i].lead);
  };
  const lensDays = days.length ? `${(dayI / days.length) * 100}%` : '0%';

  return (
    <div ref={rootRef} className={`tc${isDark ? '' : ' is-light'}`} style={{ '--tc-top': `${topOffset}px` }}
      onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
      <div ref={mapEl} className="tc-map" aria-label="Map of the TCM thunderstorm outlook" />

      <div className="tc-top">
        <div className="tc-heading">
          <h1 className="lq-title">TCM</h1>
          <p className="lq-sub">{sub}</p>
        </div>
        <button type="button" className="lq lq-btn is-round" onClick={downloadChart} disabled={saving || !picKey} aria-label="Download the chart">
          {saving ? <Loader2 className="animate-spin" /> : <Download />}
        </button>
        <button type="button" className={`lq lq-btn is-round${layersOpen ? ' is-on' : ''}`} onClick={() => setLayersOpen((o) => !o)} aria-expanded={layersOpen} aria-label="What to show">
          <Layers />
        </button>
      </div>
      {/* the model: NOVA or V3 */}
      <div className="tc-engine lq" role="tablist" aria-label="Model" style={{ '--tc-lens': engine === 'nova' ? '0%' : '100%' }}>
        <span className="tc-engine-lens" aria-hidden="true" />
        {[['nova', 'TCM NOVA'], ['v3', 'TCM V3']].map(([id, name]) => (
          <button key={id} type="button" role="tab" aria-selected={engine === id} className={engine === id ? 'is-on' : ''} onClick={() => { setEngine(id); setDayIdx(0); }}>{name}</button>
        ))}
      </div>

      {layersOpen && (
        <div className="tc-layers lq" role="dialog" aria-label="What to show">
          <div className="tc-layers-head"><b>Show</b><button type="button" onClick={() => setLayersOpen(false)} aria-label="Close"><X /></button></div>
          <div className="tc-layers-group">
            {hazards.map((h) => (
              <button key={h.id} type="button" className={`tc-layer${h.id === hazard ? ' is-on' : ''}`} aria-pressed={h.id === hazard}
                onClick={() => (engine === 'v3' ? setV3Hazard : setNovaHazard)(h.id)}>
                {h.name}{h.id === hazard && <Check />}
              </button>
            ))}
          </div>
          <span className="tc-layers-label">Style</span>
          <div className="tc-seg" role="radiogroup" aria-label="Style">
            {STYLES.map((st) => (
              <button key={st.id} type="button" role="radio" aria-checked={style === st.id} className={style === st.id ? 'is-on' : ''} onClick={() => setStyle(st.id)} title={st.note}>{st.name}</button>
            ))}
          </div>
          <div className="tc-switch-row">
            <Star aria-hidden="true" /><span>Highest risk</span>
            <button type="button" role="switch" aria-checked={starOn} aria-label="Mark the highest risk with a star" className="lq-switch" onClick={() => setStarOn((v) => !v)} />
          </div>
        </div>
      )}

      {/* the key: the outlook's levels */}
      {!layersOpen && (
        <div className="tc-key" aria-label="Key">
          {LEVELS.map((l) => <span key={l.code}><i style={{ background: `rgb(${l.rgb.join(',')})` }} />{l.code}</span>)}
        </div>
      )}

      {/* what a tap found */}
      {probe && probeText && (
        <button type="button" className="tc-probe lq" onClick={() => setProbe(null)} aria-label="Close">
          <i style={{ background: probeText.level >= 0 ? `rgb(${LEVELS[probeText.level].rgb.join(',')})` : 'transparent' }} />
          <b>{probeText.text}</b>{probeText.value && <small>{probeText.value}</small>}<X />
        </button>
      )}

      {(loading || error) && (
        <div className="tc-note lq" role="status">
          {error === 'locked'
            ? <><Lock />TCM NOVA opens to everyone with the next update of the site</>
            : error ? <>{error}</> : <><Loader2 className="animate-spin" />Loading {engine === 'v3' ? 'TCM V3' : 'TCM NOVA'}…</>}
        </div>
      )}

      {/* the days, a lens sliding between them; NOVA's hours a slider under them */}
      <div className="tc-dock lq">
        <div className="tc-days" role="tablist" aria-label="Day" style={{ '--tc-n': Math.max(1, days.length), '--tc-at': lensDays }}>
          {days.length > 0 && <span className="tc-days-lens" aria-hidden="true" />}
          {days.map((d, i) => (
            <button key={d.key} type="button" role="tab" aria-selected={i === dayI} className={`tc-day${i === dayI ? ' is-on' : ''}`} onClick={() => setDayIdx(i)}>{d.label}</button>
          ))}
        </div>
        {engine === 'nova' && hours.length > 0 && (
          <div className="tc-time">
            {allDay && (
              <button type="button" className={`tc-allday${leadNow == null ? ' is-on' : ''}`} aria-pressed={leadNow == null} onClick={() => setLead(null)}>All day</button>
            )}
            <div ref={track} className={`tc-track${leadNow == null ? ' is-idle' : ''}`} role="slider" tabIndex={0} aria-label="Time"
              aria-valuemin={0} aria-valuemax={hours.length - 1} aria-valuenow={Math.max(0, hourIdx)}
              aria-valuetext={leadNow == null ? 'All day' : hourOf(hours[Math.max(0, hourIdx)]?.valid)}
              onPointerDown={(e) => { scrub.current = e.pointerId; try { track.current.setPointerCapture(e.pointerId); } catch { /* fine */ } pickHour(e.clientX); }}
              onPointerMove={(e) => { if (scrub.current === e.pointerId) pickHour(e.clientX); }}
              onPointerUp={() => { scrub.current = null; }} onPointerCancel={() => { scrub.current = null; }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' && hourIdx > 0) setLead(hours[hourIdx - 1].lead);
                if (e.key === 'ArrowRight') setLead(hours[Math.min(hours.length - 1, hourIdx + 1)].lead);
              }}
              style={{ '--tc-pos': `${hours.length < 2 ? 0 : (Math.max(0, hourIdx) / (hours.length - 1)) * 100}%` }}>
              <div className="tc-rail">
                {hours.map((h, i) => <i key={h.lead} style={{ left: `${hours.length < 2 ? 0 : (i / (hours.length - 1)) * 100}%` }} />)}
                {leadNow != null && <span className="tc-thumb" />}
              </div>
              <div className="tc-ticks" aria-hidden="true">
                {hours.map((h, i) => <span key={h.lead} className={i === hourIdx ? 'is-on' : ''} style={{ left: `${hours.length < 2 ? 0 : (i / (hours.length - 1)) * 100}%` }}>{hourOf(h.valid).slice(0, 2)}</span>)}
              </div>
            </div>
          </div>
        )}
        {busy && <Loader2 className="tc-busy animate-spin" aria-hidden="true" />}
      </div>
    </div>
  );
}
