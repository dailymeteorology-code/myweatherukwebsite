/* ════════════════════════════════════════════════════════════════════════════
   SOLAR ECLIPSE FORECAST — GRAPHIC TOOL
   ────────────────────────────────────────────────────────────────────────────
   A plain UK & Ireland map with a marker per location: the weather symbol above
   the point, the name below it, and the obscuration and peak time under that.
   Symbols can be set by hand or pulled from the Met Office for a chosen date,
   taking the forecast hour closest to each location's own peak time.

   NO COVERAGE SHADING. An earlier version tinted the map with a coverage ramp,
   which meant the card carried a field of colour that nothing had computed —
   an angle and two end values typed in by hand. The figures in the labels are
   the real content, so the map is just the map.

   THE MARKER IS ANCHORED ON ITS DOT. The stack is symbol / dot / name / figures,
   and the dot must sit exactly on the projected coordinate. Laying the stack out
   from its top instead put every point roughly sixty pixels south of where it
   belonged — which is why Newcastle sat out in the North Sea.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import html2canvas from 'html2canvas';
import {
  Download, Plus, Trash2, MapPin, Loader2, Upload, Check, CloudDownload, AlertTriangle,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { weatherIcons } from '@/components/WeatherIcons';
import { loadSynopticGeo } from '@/lib/synopticGeo';
import { codeInfo } from '@/lib/metOfficeWeatherCodes';
import { hourNearest } from '@/lib/eclipseForecast';

const GRAPHIC_W = 1240;
const GRAPHIC_H = 1550;

const MAP_X = 60;
const MAP_Y = 232;
const MAP_W = 1120;
const MAP_H = 1058;

const ICON_KEYS = Object.keys(weatherIcons);

const DEFAULTS = {
  eyebrow: 'PARTIAL SOLAR ECLIPSE  ·  UK & IRELAND',
  title: 'SOLAR ECLIPSE FORECAST',
  date: 'Wednesday 12 August 2026',
  isoDate: '2026-08-12',
};

/* Figures read off the reference card. dx/dy nudge a label clear of its
   neighbours — the Midlands and the south-east crowd otherwise. */
const START_LOCATIONS = [
  { id: 1, name: 'Inverness',  lat: 57.478, lon: -4.224, pct: 90.74, time: '19:03', icon: 'Sunny',           dx: -18, dy: 0 },
  { id: 2, name: 'Edinburgh',  lat: 55.953, lon: -3.188, pct: 90.71, time: '19:06', icon: 'Partly Cloudy',   dx: -14, dy: 0 },
  { id: 3, name: 'Newcastle',  lat: 54.978, lon: -1.618, pct: 90.22, time: '19:07', icon: 'Cloudy',          dx: 74, dy: 6 },
  { id: 4, name: 'Belfast',    lat: 54.597, lon: -5.930, pct: 93.09, time: '19:08', icon: 'Light Rain',      dx: -66, dy: 0 },
  { id: 5, name: 'Birmingham', lat: 52.486, lon: -1.890, pct: 91.79, time: '19:12', icon: 'Sunny Intervals', dx: 62, dy: -10 },
  { id: 6, name: 'Cardiff',    lat: 51.481, lon: -3.179, pct: 93.24, time: '19:13', icon: 'Partly Cloudy',   dx: -76, dy: 18 },
  { id: 7, name: 'London',     lat: 51.507, lon: -0.128, pct: 91.41, time: '19:13', icon: 'Sunny',           dx: 74, dy: 30 },
  { id: 8, name: 'Plymouth',   lat: 50.376, lon: -4.143, pct: 94.66, time: '19:16', icon: 'Overcast',        dx: -70, dy: 22 },
];

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#64748b' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const input = {
  background: '#0b1220', border: '1px solid rgba(148,163,184,0.22)', borderRadius: 8,
  color: '#e2e8f0', fontSize: 13, padding: '7px 9px', width: '100%', fontFamily: 'inherit', outline: 'none',
};

/** Upload an image and store its URL on SiteSettings under `field`. */
function LogoUpload({ label, field, url, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const list = await base44.entities.SiteSettings.list();
      const row = list?.[0];
      if (row) await base44.entities.SiteSettings.update(row.id, { [field]: file_url });
      else await base44.entities.SiteSettings.create({ site_name: 'MyWeatherUK', [field]: file_url });
      onDone(file_url);
    } catch (e2) {
      setErr(e2?.message || 'Upload failed.');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <label style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 9,
        cursor: busy ? 'default' : 'pointer', fontSize: 12, fontWeight: 700,
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(148,163,184,0.25)', color: '#cbd5e1',
      }}>
        {busy ? <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
          : url ? <Check style={{ width: 13, height: 13, color: '#34d399' }} />
            : <Upload style={{ width: 13, height: 13 }} />}
        {busy ? 'Uploading…' : url ? `${label} set — replace` : `Upload ${label}`}
        <input type="file" accept="image/*" onChange={pick} disabled={busy} style={{ display: 'none' }} />
      </label>
      {err && <span style={{ fontSize: 10.5, color: '#fca5a5' }}>{err}</span>}
    </div>
  );
}

export default function SolarEclipseGraphicTool() {
  const graphicRef = useRef(null);
  const scaleWrapRef = useRef(null);

  const [scale, setScale] = useState(1);
  const [geo, setGeo] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [meta, setMeta] = useState(DEFAULTS);
  const [logos, setLogos] = useState({ site: '', tcm: '' });
  const [placing, setPlacing] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const [locations, setLocations] = useState(START_LOCATIONS);
  const [fetching, setFetching] = useState(false);
  const [fetchNote, setFetchNote] = useState('');

  /* Fit the whole card on screen at once. A ResizeObserver rather than a
     mount-time measurement: the tool appears in a tab that has only just been
     switched to, so the wrapper can still be zero-width on first render, and
     treating that zero as a real width pinned the preview at full size and cut
     the card off. Height is fitted against the viewport too. */
  useEffect(() => {
    const el = scaleWrapRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth;
      if (!w) return;
      setScale(actualSize ? 1 : Math.min(1, w / GRAPHIC_W, (window.innerHeight * 0.78) / GRAPHIC_H));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [actualSize]);

  useEffect(() => {
    let dead = false;
    loadSynopticGeo({ extent: 'uk', viewW: MAP_W, viewH: MAP_H })
      .then(g => { if (!dead) setGeo(g); })
      .catch(() => { if (!dead) setGeo(null); });
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    let dead = false;
    base44.entities.SiteSettings.list()
      .then((list) => {
        if (dead) return;
        setLogos({ site: list?.[0]?.logo_url || '', tcm: list?.[0]?.tcm_logo_url || '' });
      })
      .catch(() => {});
    return () => { dead = true; };
  }, []);

  const setField = (k, v) => setMeta(m => ({ ...m, [k]: v }));
  const setLoc = (id, patch) => setLocations(ls => ls.map(l => (l.id === id ? { ...l, ...patch } : l)));
  const removeLoc = (id) => setLocations(ls => ls.filter(l => l.id !== id));

  const onMapClick = useCallback((e) => {
    if (!placing || !geo?.unproject) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * MAP_W;
    const y = ((e.clientY - rect.top) / rect.height) * MAP_H;
    const [lon, lat] = geo.unproject(x, y);
    setLocations(ls => [...ls, {
      id: Date.now(), name: 'New location',
      lat: Number(lat.toFixed(3)), lon: Number(lon.toFixed(3)),
      pct: 90, time: '', icon: 'Sunny', dx: 0, dy: 0,
    }]);
    setPlacing(false);
  }, [placing, geo]);

  /* Pull each location's symbol from the Met Office for the chosen date.
     Sequential, not parallel: eight simultaneous calls hammer one API key that
     the rest of the site shares, and the whole run still takes a few seconds. */
  const fetchForecasts = async () => {
    setFetching(true);
    setFetchNote('');
    const failures = [];
    let got = 0;

    for (const loc of locations) {
      try {
        const res = await base44.functions.invoke('getMetOfficeLocationWeather', {
          location: loc.name, latitude: loc.lat, longitude: loc.lon,
        });
        const body = res?.data ?? res;
        const entry = hourNearest(body?.rawHourly, meta.isoDate, loc.time);
        if (!entry) { failures.push(`${loc.name} (no hour for that date)`); continue; }
        const info = codeInfo(entry.significantWeatherCode);
        setLoc(loc.id, { icon: info.icon });
        got += 1;
      } catch (e) {
        const body = e?.response?.data;
        failures.push(`${loc.name}${body?.error ? ` (${body.error})` : ''}`);
      }
    }

    setFetching(false);
    setFetchNote(
      failures.length
        ? `${got} of ${locations.length} updated. Not updated: ${failures.join('; ')}`
        : `All ${got} locations updated from the Met Office.`,
    );
  };

  const download = async () => {
    if (!graphicRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(graphicRef.current, {
        backgroundColor: null, scale: 2, useCORS: true, logging: false,
        width: GRAPHIC_W, height: GRAPHIC_H,
        windowWidth: GRAPHIC_W, windowHeight: GRAPHIC_H,
        x: 0, y: 0, scrollX: 0, scrollY: 0,
      });
      const link = document.createElement('a');
      link.download = `solar-eclipse-forecast-${meta.isoDate}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally { setExporting(false); }
  };

  const placed = useMemo(() => (geo ? locations.map(l => {
    const [x, y] = geo.project(l.lon, l.lat);
    return { ...l, x, y };
  }) : []), [geo, locations]);

  /* Headline figures, measured from the locations themselves rather than typed
     in — so they cannot disagree with the markers below them. */
  const summary = useMemo(() => {
    const withPct = locations.filter(l => Number.isFinite(l.pct));
    const times = locations.map(l => l.time).filter(Boolean).sort();
    const top = withPct.length ? withPct.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;
    return {
      peak: top,
      window: times.length ? `${times[0]} – ${times[times.length - 1]}` : '',
      count: locations.length,
    };
  }, [locations]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, color: '#e2e8f0' }}>

      {/* ══ Controls ══ */}
      <div style={{ background: '#0c1422', border: '1px solid rgba(148,163,184,0.10)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Field label="Eyebrow"><input style={input} value={meta.eyebrow} onChange={e => setField('eyebrow', e.target.value)} /></Field>
          <Field label="Title"><input style={input} value={meta.title} onChange={e => setField('title', e.target.value)} /></Field>
          <Field label="Date line"><input style={input} value={meta.date} onChange={e => setField('date', e.target.value)} /></Field>
          <Field label="Forecast date">
            <input style={input} type="date" value={meta.isoDate} onChange={e => setField('isoDate', e.target.value)} />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button" onClick={fetchForecasts} disabled={fetching}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 15px', borderRadius: 10,
              cursor: fetching ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 800,
              background: 'rgba(45,212,191,0.16)', border: '1px solid rgba(94,234,212,0.5)', color: '#5eead4',
            }}>
            {fetching ? <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> : <CloudDownload style={{ width: 14, height: 14 }} />}
            {fetching ? 'Fetching…' : 'Fetch Met Office symbols'}
          </button>

          <LogoUpload label="MyWeatherUK logo" field="logo_url" url={logos.site}
                      onDone={(u) => setLogos(l => ({ ...l, site: u }))} />
          <LogoUpload label="TCM Space logo" field="tcm_logo_url" url={logos.tcm}
                      onDone={(u) => setLogos(l => ({ ...l, tcm: u }))} />

          <button
            type="button" onClick={() => setPlacing(p => !p)}
            style={{
              marginLeft: 'auto', padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 700,
              background: placing ? 'rgba(129,140,248,0.25)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${placing ? '#818cf8' : 'rgba(148,163,184,0.25)'}`,
              color: placing ? '#c7d2fe' : '#cbd5e1',
              display: 'inline-flex', alignItems: 'center', gap: 7,
            }}>
            <MapPin style={{ width: 14, height: 14 }} />
            {placing ? 'Click the map…' : 'Add location'}
          </button>
        </div>

        {fetchNote && (
          <p style={{ margin: 0, display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11.5, lineHeight: 1.5, color: fetchNote.startsWith('All') ? '#5eead4' : '#fbbf24' }}>
            {!fetchNote.startsWith('All') && <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0, marginTop: 1 }} />}
            {fetchNote}
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {locations.map(l => (
            <div key={l.id} style={{
              display: 'grid', gap: 8, alignItems: 'end',
              gridTemplateColumns: 'minmax(105px,1.3fr) 78px 72px minmax(115px,1.1fr) 62px 62px 32px',
              background: '#0b1220', border: '1px solid rgba(148,163,184,0.14)', borderRadius: 10, padding: 8,
            }}>
              <Field label="Name"><input style={input} value={l.name} onChange={e => setLoc(l.id, { name: e.target.value })} /></Field>
              <Field label="%"><input style={input} type="number" step="0.01" value={l.pct} onChange={e => setLoc(l.id, { pct: Number(e.target.value) })} /></Field>
              <Field label="Time"><input style={input} value={l.time} onChange={e => setLoc(l.id, { time: e.target.value })} /></Field>
              <Field label="Weather symbol">
                <select style={input} value={l.icon} onChange={e => setLoc(l.id, { icon: e.target.value })}>
                  {ICON_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </Field>
              <Field label="Nudge X"><input style={input} type="number" value={l.dx} onChange={e => setLoc(l.id, { dx: Number(e.target.value) })} /></Field>
              <Field label="Nudge Y"><input style={input} type="number" value={l.dy} onChange={e => setLoc(l.id, { dy: Number(e.target.value) })} /></Field>
              <button type="button" onClick={() => removeLoc(l.id)} aria-label={`Remove ${l.name}`}
                      style={{ height: 32, borderRadius: 8, cursor: 'pointer', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' }}>
                <Trash2 style={{ width: 13, height: 13, margin: '0 auto' }} />
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setPlacing(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(148,163,184,0.25)', color: '#cbd5e1' }}>
            <Plus style={{ width: 14, height: 14 }} /> Add location
          </button>
          <button type="button" onClick={download} disabled={exporting || !geo}
                  style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 10, cursor: exporting ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 800, background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(129,140,248,0.55)', color: '#c7d2fe' }}>
            {exporting ? <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> : <Download style={{ width: 14, height: 14 }} />}
            {exporting ? 'Exporting…' : 'Download PNG'}
          </button>
        </div>
      </div>

      {/* ══ Preview scale ══ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#64748b' }}>
          Preview · {Math.round(scale * 100)}%
        </span>
        <button type="button" onClick={() => setActualSize(v => !v)}
          style={{
            marginLeft: 'auto', padding: '5px 12px', borderRadius: 99, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
            background: actualSize ? 'rgba(129,140,248,0.22)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${actualSize ? '#818cf8' : 'rgba(148,163,184,0.25)'}`,
            color: actualSize ? '#c7d2fe' : '#cbd5e1',
          }}>
          {actualSize ? 'Fit to screen' : 'Actual size (1240×1550)'}
        </button>
      </div>

      {/* ══ The card ══ */}
      <div
        ref={scaleWrapRef}
        style={{
          width: '100%', maxWidth: '100%', height: GRAPHIC_H * scale,
          display: 'flex', justifyContent: 'center',
          overflow: actualSize ? 'auto' : 'hidden',
        }}>
        <div
          ref={graphicRef}
          style={{
            width: GRAPHIC_W, height: GRAPHIC_H, position: 'relative', flexShrink: 0,
            transform: `scale(${scale})`, transformOrigin: 'top center',
            background: 'linear-gradient(160deg,#0a1b30 0%,#0c1937 42%,#131847 76%,#191352 100%)',
            fontFamily: "'DM Sans', system-ui, sans-serif", overflow: 'hidden',
          }}
        >
          {/* Faint graticule, so the map is not floating on flat colour */}
          <svg width={GRAPHIC_W} height={GRAPHIC_H} style={{ position: 'absolute', inset: 0, opacity: 0.28 }}>
            {Array.from({ length: 9 }, (_, i) => (
              <line key={`g${i}`} x1={-200 + i * 190} y1={0} x2={60 + i * 190} y2={GRAPHIC_H}
                    stroke="rgba(148,163,184,0.16)" strokeWidth="1" strokeDasharray="10 14" />
            ))}
          </svg>

          {/* Header */}
          <div style={{ position: 'absolute', left: 60, top: 44, right: 220 }}>
            <div style={{ fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 16, letterSpacing: '0.22em', color: '#5eead4' }}>
              {meta.eyebrow}
            </div>
            <div style={{ fontSize: 62, fontWeight: 900, letterSpacing: '-0.025em', color: '#fff', lineHeight: 1.04, marginTop: 10 }}>
              {meta.title}
            </div>
            <div style={{ fontSize: 25, fontWeight: 600, color: '#cbd5e1', marginTop: 6 }}>
              {meta.date}
            </div>
          </div>

          {/* Crescent */}
          <svg width="150" height="150" viewBox="0 0 100 100" style={{ position: 'absolute', right: 52, top: 40 }}>
            <defs>
              <mask id="ecl-crescent">
                <rect width="100" height="100" fill="black" />
                <circle cx="50" cy="50" r="38" fill="white" />
                <circle cx="61" cy="44" r="35" fill="black" />
              </mask>
            </defs>
            <circle cx="50" cy="50" r="43" fill="#fde68a" opacity="0.10" />
            <circle cx="50" cy="50" r="38" fill="#fef3c7" mask="url(#ecl-crescent)" />
          </svg>

          {/* Summary strip — measured from the markers, not typed in */}
          <div style={{
            position: 'absolute', left: 60, right: 60, top: 186,
            display: 'flex', gap: 10, alignItems: 'stretch',
          }}>
            {[
              { k: 'PEAK WINDOW', v: summary.window || '—', c: '#5eead4' },
              { k: 'GREATEST COVERAGE', v: summary.peak ? `${summary.peak.pct.toFixed(2)}%` : '—', c: '#fff', sub: summary.peak?.name },
              { k: 'LOCATIONS', v: String(summary.count), c: '#fff' },
            ].map(s => (
              <div key={s.k} style={{
                flex: 1, padding: '9px 16px', borderRadius: 12,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.18)',
                display: 'flex', alignItems: 'baseline', gap: 10,
              }}>
                <span style={{ fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 11, letterSpacing: '0.16em', color: '#94a3b8' }}>
                  {s.k}
                </span>
                <span style={{ marginLeft: 'auto', fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 20, fontWeight: 800, color: s.c }}>
                  {s.v}
                </span>
                {s.sub && <span style={{ fontSize: 14, color: '#94a3b8' }}>{s.sub}</span>}
              </div>
            ))}
          </div>

          {/* Map */}
          <div
            onClick={onMapClick}
            style={{
              position: 'absolute', left: MAP_X, top: MAP_Y, width: MAP_W, height: MAP_H,
              cursor: placing ? 'crosshair' : 'default',
            }}
          >
            {!geo ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(148,163,184,0.6)' }}>
                Loading map…
              </div>
            ) : (
              <>
                <svg width={MAP_W} height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ display: 'block' }}>
                  <path d={geo.landPathD} fill="rgba(226,232,240,0.085)"
                        stroke="rgba(148,163,184,0.5)" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>

                {/* One marker per location, anchored on its dot. The wrapper has
                    no size, so `left/top` IS the projected coordinate: the dot
                    is centred on it, the symbol sits above, labels below. */}
                {placed.map(l => {
                  const Icon = weatherIcons[l.icon];
                  return (
                    <div key={l.id} style={{
                      position: 'absolute', left: l.x + (l.dx || 0), top: l.y + (l.dy || 0),
                      width: 0, height: 0, pointerEvents: 'none',
                    }}>
                      {Icon && (
                        <span style={{
                          position: 'absolute', left: 0, bottom: 13, transform: 'translateX(-50%)',
                          filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.7))',
                        }}>
                          <Icon className="w-16 h-16" />
                        </span>
                      )}

                      <span style={{
                        position: 'absolute', left: 0, top: 0, transform: 'translate(-50%,-50%)',
                        width: 14, height: 14, borderRadius: '50%',
                        background: '#0b1220', border: '3px solid #fff',
                        boxShadow: '0 0 0 3px rgba(2,6,23,0.55), 0 0 12px rgba(255,255,255,0.35)',
                      }} />

                      <span style={{
                        position: 'absolute', left: 0, top: 13, transform: 'translateX(-50%)',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', whiteSpace: 'nowrap',
                      }}>
                        <span style={{ fontSize: 26, fontWeight: 800, color: '#fff', textShadow: '0 2px 10px rgba(2,6,23,0.98)' }}>
                          {l.name}
                        </span>
                        <span style={{
                          marginTop: 3, display: 'inline-flex', alignItems: 'center', gap: 8,
                          fontFamily: "'DM Mono', ui-monospace, monospace",
                          background: 'rgba(2,6,23,0.86)', border: '1px solid rgba(148,163,184,0.34)',
                          borderRadius: 9, padding: '3px 10px',
                        }}>
                          <span style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>
                            {Number(l.pct).toFixed(2)}%
                          </span>
                          {l.time && (
                            <>
                              <span style={{ width: 1, height: 16, background: 'rgba(148,163,184,0.4)' }} />
                              <span style={{ fontSize: 19, fontWeight: 700, color: '#5eead4' }}>{l.time}</span>
                            </>
                          )}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Key — its own band, clear of the map so a southern label cannot
              land on top of it. */}
          <div style={{
            position: 'absolute', left: 60, right: 60, top: MAP_Y + MAP_H + 14,
            display: 'flex', alignItems: 'center', gap: 34, flexWrap: 'wrap',
            padding: '11px 18px', borderRadius: 12,
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.16)',
          }}>
            <span style={{ fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 12, letterSpacing: '0.2em', color: '#94a3b8' }}>
              KEY
            </span>
            {[
              { c: '#ffffff', t: 'COVERAGE AT MAXIMUM ECLIPSE' },
              { c: '#5eead4', t: 'PEAK OBSCURATION TIME · BST' },
            ].map(k => (
              <div key={k.t} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: k.c }} />
                <span style={{ fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 13, letterSpacing: '0.07em', color: '#cbd5e1' }}>
                  {k.t}
                </span>
              </div>
            ))}
            <span style={{ marginLeft: 'auto', fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 12, color: 'rgba(148,163,184,0.7)' }}>
              SYMBOLS · MET OFFICE FORECAST
            </span>
          </div>

          {/* Footer */}
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: 128,
            background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 44,
          }}>
            {logos.site && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <img src={logos.site} alt="" crossOrigin="anonymous" style={{ height: 72, width: 'auto', objectFit: 'contain' }} />
                <div style={{ lineHeight: 1.1 }}>
                  <div style={{ fontSize: 32, fontWeight: 800, color: '#0f172a' }}>
                    MyWeather<span style={{ color: '#0284c7' }}>UK</span>
                  </div>
                  <div style={{ fontSize: 15, color: '#0284c7', fontWeight: 600 }}>@MyWeatherUK</div>
                </div>
              </div>
            )}
            {logos.site && logos.tcm && (
              <div style={{ width: 2, height: 64, background: '#cbd5e1', transform: 'rotate(14deg)' }} />
            )}
            {/* The TCM lockup contains its own wordmark, so it is shown whole
                rather than having "TCM SPACE" set beside it in type. */}
            {logos.tcm && (
              <img src={logos.tcm} alt="" crossOrigin="anonymous" style={{ height: 84, width: 'auto', objectFit: 'contain' }} />
            )}
          </div>

          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 128, height: 5,
            background: 'linear-gradient(90deg,#6366f1,#a855f7,#ec4899,#f43f5e,#f97316,#facc15)',
          }} />
        </div>
      </div>
    </div>
  );
}
