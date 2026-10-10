/* ════════════════════════════════════════════════════════════════════════════
   TCM OUTLOOKS
   ────────────────────────────────────────────────────────────────────────────
   Two engines behind one page. V5 is what this page is built around; V3 is the
   previous production engine and is rendered unchanged underneath its own tab,
   because it still works and nothing here replaces it.

   WHY THIS PAGE LOOKS NOTHING LIKE THE V3 ONE.

   V3 draws risk areas: filled polygons over a map, the shape most people picture
   when they hear "outlook". V5 does not produce that, and pretending otherwise
   would be the single most misleading thing this page could do. V5 evaluates
   twenty named points, not the 2 km grid — its own products say so, in a warning
   it attaches to everything it exports:

       "the production forecast is evaluated at POINTS, not on the 2 km grid …
        Every product built from this carries the same statement rather than
        implying grid coverage it does not have"

   Drawing polygons from twenty points would invent coverage that was never
   computed. So this page shows points as points.

   Two other things travel with every V5 forecast and are given the same
   prominence here rather than being tucked into a footnote:

     · `calibration: "uncalibrated"` — the probabilities describe the structure
       of the forecast, not a verified likelihood. A 2% here is not a 2% you can
       hold the model to.
     · `degraded: true` with the reasons listed — every cycle currently exported
       ran with models missing.

   A forecast page that hid those would be a worse page, not a cleaner one. The
   design puts them in the first screen, next to the number they qualify.

   Dark throughout, deliberately: this is an instrument panel, and the V3 page's
   light mode is a reading mode for a map, which this is not.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Layers, ChevronDown, AlertTriangle, Clock, MapPin, Activity,
  ShieldAlert, Loader2, RefreshCw, Info,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import WeatherPatterns from './WeatherPatterns';

/* ── palette ─────────────────────────────────────────────────────────────── */
const C = {
  bg: '#070b14',
  panel: 'rgba(148,163,184,0.045)',
  panelSolid: '#0d1524',
  border: 'rgba(148,163,184,0.14)',
  borderBright: 'rgba(148,163,184,0.26)',
  text: '#e8edf6',
  mid: '#93a3b8',
  faint: 'rgba(148,163,184,0.55)',
  sky: '#38bdf8',
  violet: '#a78bfa',
  amber: '#fbbf24',
  red: '#f87171',
  green: '#4ade80',
};
const MONO = "'DM Mono','SFMono-Regular',ui-monospace,monospace";

/* ── the twenty points V5 evaluates ──────────────────────────────────────────
   The bundle keys points by coordinate ("51.514,-0.138@T+12"), which is precise
   and unreadable. These are the places those coordinates are, matched to two
   decimal places so a rounding change upstream does not silently orphan a row —
   an unmatched point still renders, just under its coordinates. */
const PLACES = [
  [51.51, -0.14, 'London'], [52.47, -1.91, 'Birmingham'], [53.48, -2.23, 'Manchester'],
  [53.80, -1.56, 'Leeds'], [52.63, 1.31, 'Norwich'], [51.45, -2.59, 'Bristol'],
  [50.73, -3.52, 'Exeter'], [50.81, -0.15, 'Brighton'], [51.48, -3.19, 'Cardiff'],
  [52.41, -4.09, 'Aberystwyth'], [53.06, -3.96, 'Llandudno'], [54.99, -1.63, 'Newcastle'],
  [54.88, -2.94, 'Carlisle'], [55.86, -4.26, 'Glasgow'], [55.96, -3.20, 'Edinburgh'],
  [57.48, -4.23, 'Inverness'], [56.81, -5.12, 'Fort William'], [54.60, -5.94, 'Belfast'],
  [53.35, -6.26, 'Dublin'], [52.21, 0.13, 'Cambridge'],
];

function placeFor(lat, lon) {
  const hit = PLACES.find(([a, b]) => Math.abs(a - lat) < 0.06 && Math.abs(b - lon) < 0.06);
  return hit ? hit[2] : `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
}

/** "51.514,-0.138@T+12" → { lat, lon, lead, place } */
function parsePointKey(key) {
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)@T\+(\d+)$/.exec(key);
  if (!m) return null;
  const lat = Number(m[1]); const lon = Number(m[2]);
  return { lat, lon, lead: Number(m[3]), place: placeFor(lat, lon) };
}

/* ── formatting ──────────────────────────────────────────────────────────── */
const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`);

function whenText(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + 'Z';
}

function ageText(iso) {
  if (!iso) return null;
  const hours = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (!Number.isFinite(hours)) return null;
  if (hours < 1) return 'less than an hour old';
  if (hours < 48) return `${Math.round(hours)} hours old`;
  return `${Math.round(hours / 24)} days old`;
}

/* ── small building blocks ───────────────────────────────────────────────── */
function Panel({ title, icon: Icon, accent = C.sky, right, children, style }) {
  return (
    <section style={{
      background: C.panel, border: `1px solid ${C.border}`, borderRadius: 16,
      padding: '15px 17px', ...style,
    }}>
      {(title || right) && (
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          {Icon && <Icon style={{ width: 14, height: 14, color: accent }} />}
          <h2 style={{
            margin: 0, fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: C.mid, fontFamily: MONO,
          }}>{title}</h2>
          {right && <div style={{ marginLeft: 'auto' }}>{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

function Tag({ tone = 'neutral', children, title }) {
  const tones = {
    neutral: [C.faint, 'rgba(148,163,184,0.10)', 'rgba(148,163,184,0.25)'],
    warn: [C.amber, 'rgba(251,191,36,0.12)', 'rgba(251,191,36,0.35)'],
    bad: [C.red, 'rgba(248,113,113,0.12)', 'rgba(248,113,113,0.35)'],
    good: [C.green, 'rgba(74,222,128,0.12)', 'rgba(74,222,128,0.35)'],
    info: [C.sky, 'rgba(56,189,248,0.12)', 'rgba(56,189,248,0.35)'],
  };
  const [fg, bg, bd] = tones[tone] || tones.neutral;
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px',
      borderRadius: 99, fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.06em',
      textTransform: 'uppercase', fontFamily: MONO,
      color: fg, background: bg, border: `1px solid ${bd}`, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

/* ── engine switcher ─────────────────────────────────────────────────────────
   V5 first because this page is built around it; V3 is not deprecated and is
   not labelled as though it were. */
function EngineSwitcher({ engine, setEngine }) {
  const [open, setOpen] = useState(false);
  const row = (id, name, blurb, tone, tag) => {
    const on = engine === id;
    return (
      <button key={id} type="button" onClick={() => { setEngine(id); setOpen(false); }}
        style={{
          display: 'flex', gap: 10, width: '100%', textAlign: 'left', padding: '10px 11px',
          borderRadius: 11, cursor: 'pointer', marginBottom: 6,
          background: on ? 'rgba(56,189,248,0.12)' : 'rgba(148,163,184,0.05)',
          border: `1px solid ${on ? 'rgba(56,189,248,0.42)' : C.border}`,
        }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0,
          background: on ? C.sky : C.faint, boxShadow: on ? `0 0 7px ${C.sky}` : 'none',
        }} />
        <span style={{ flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.84rem', fontWeight: 800, color: C.text }}>
            {name}
            {on ? <Tag tone="info">selected</Tag> : tag ? <Tag tone={tone}>{tag}</Tag> : null}
          </span>
          <span style={{ display: 'block', fontSize: '0.68rem', color: C.mid, marginTop: 3, lineHeight: 1.45 }}>
            {blurb}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px',
          borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
          fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em',
          background: open ? 'rgba(129,140,248,0.16)' : 'rgba(148,163,184,0.06)',
          border: `1px solid ${open ? 'rgba(129,140,248,0.45)' : C.border}`,
          color: open ? C.violet : C.text,
        }}>
        <Layers style={{ width: 13, height: 13 }} />
        TCM {engine.toUpperCase()}
        <ChevronDown style={{ width: 13, height: 13, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 290, zIndex: 60,
          padding: 8, borderRadius: 14, background: C.panelSolid,
          border: `1px solid ${C.borderBright}`, boxShadow: '0 22px 50px rgba(2,6,15,0.6)',
        }}>
          <div style={{
            fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
            color: C.faint, margin: '2px 4px 8px', fontFamily: MONO,
          }}>Engine version</div>
          {row('v5', 'TCM V5', 'Probabilistic, twenty points, four days. Shows its own limits.', 'warn', 'new')}
          {row('v3', 'TCM V3', 'The risk-area map. Drawn outlooks over the whole country.', 'neutral', 'live')}
        </div>
      )}
    </div>
  );
}

/* ── the qualifiers that travel with every V5 forecast ───────────────────── */
function Provenance({ manifest, meta }) {
  const [openReasons, setOpenReasons] = useState(false);
  const reasons = manifest?.degraded_because || [];

  return (
    <Panel title="Read this first" icon={ShieldAlert} accent={C.amber}
      style={{ borderColor: 'rgba(251,191,36,0.28)', background: 'rgba(251,191,36,0.045)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 11 }}>
        {meta?.calibration === 'uncalibrated' && <Tag tone="warn">uncalibrated</Tag>}
        {manifest?.degraded && <Tag tone="warn">ran degraded</Tag>}
        <Tag tone="neutral">points, not a grid</Tag>
        {manifest?.status && <Tag tone={manifest.status === 'published' ? 'good' : 'bad'}>{manifest.status}</Tag>}
      </div>

      <ul style={{ margin: 0, paddingLeft: 17, color: C.mid, fontSize: '0.78rem', lineHeight: 1.62 }}>
        <li>
          These probabilities are <strong style={{ color: C.text }}>not calibrated against observations</strong>.
          They describe the structure of the forecast, not a verified likelihood.
        </li>
        <li>
          V5 evaluates <strong style={{ color: C.text }}>twenty points</strong>, not the 2 km grid.
          Nothing between the points has been computed, so nothing between them is drawn.
        </li>
        {manifest?.degraded && (
          <li>
            This cycle ran with <strong style={{ color: C.text }}>models missing</strong>, which lowers
            confidence. It does not make storms less likely.
            {reasons.length > 0 && (
              <button type="button" onClick={() => setOpenReasons((v) => !v)}
                style={{
                  marginLeft: 7, padding: '1px 8px', borderRadius: 99, cursor: 'pointer',
                  fontSize: '0.6rem', fontWeight: 800, fontFamily: 'inherit',
                  background: 'rgba(251,191,36,0.14)', border: '1px solid rgba(251,191,36,0.35)',
                  color: C.amber,
                }}>
                {openReasons ? 'hide' : `${reasons.length} reasons`}
              </button>
            )}
          </li>
        )}
      </ul>

      {openReasons && (
        <ul style={{
          margin: '11px 0 0', paddingLeft: 17, color: C.faint,
          fontSize: '0.72rem', lineHeight: 1.6, fontFamily: MONO,
        }}>
          {reasons.map((r, i) => <li key={i} style={{ marginBottom: 4 }}>{r}</li>)}
        </ul>
      )}
    </Panel>
  );
}

/* ── the twenty points, ranked ───────────────────────────────────────────── */
function PointTable({ points }) {
  if (!points.length) return null;
  const max = Math.max(...points.map((p) => p.value), 0.0001);

  return (
    <Panel title={`Points · ${points.length}`} icon={MapPin} accent={C.sky}
      right={<span style={{ fontSize: '0.62rem', color: C.faint, fontFamily: MONO }}>T+{points[0].lead}</span>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {points.map((p) => (
          <div key={`${p.lat},${p.lon}`} style={{
            display: 'grid', gridTemplateColumns: '1fr 64px', alignItems: 'center',
            gap: 10, padding: '6px 8px', borderRadius: 8,
            background: 'rgba(148,163,184,0.035)',
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: C.text, marginBottom: 4 }}>
                {p.place}
              </div>
              {/* The bar is scaled to the highest point in this cycle, not to
                  100% — at these values a 0–100 scale would render twenty
                  invisible slivers and say nothing. The number is absolute. */}
              <div style={{ height: 4, borderRadius: 99, background: 'rgba(148,163,184,0.12)', overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.max(3, (p.value / max) * 100)}%`, height: '100%',
                  borderRadius: 99, background: `linear-gradient(90deg, ${C.sky}, ${C.violet})`,
                }} />
              </div>
            </div>
            <div style={{
              textAlign: 'right', fontFamily: MONO, fontSize: '0.82rem',
              fontWeight: 800, color: p.value >= max * 0.75 ? C.sky : C.mid,
            }}>
              {pct(p.value)}
            </div>
          </div>
        ))}
      </div>
      <p style={{ margin: '11px 0 0', fontSize: '0.66rem', color: C.faint, lineHeight: 1.55 }}>
        Bars are relative to the highest point in this cycle. The percentage is absolute.
      </p>
    </Panel>
  );
}

/* ── lead times ──────────────────────────────────────────────────────────── */
function FrameTimeline({ frames }) {
  if (!frames?.length) return null;
  return (
    <Panel title="Lead times" icon={Clock} accent={C.violet}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {frames.map((f, i) => {
          const has = f.peak_probability != null;
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px',
              borderRadius: 9, background: has ? 'rgba(56,189,248,0.07)' : 'rgba(148,163,184,0.03)',
              border: `1px solid ${has ? 'rgba(56,189,248,0.22)' : C.border}`,
            }}>
              <span style={{ fontFamily: MONO, fontSize: '0.72rem', color: has ? C.text : C.faint, minWidth: 128 }}>
                {whenText(f.valid_time)}
              </span>
              {has ? (
                <>
                  <span style={{ fontSize: '0.72rem', color: C.mid }}>
                    peak <strong style={{ color: C.sky, fontFamily: MONO }}>{pct(f.peak_probability)}</strong>
                  </span>
                  <span style={{ fontSize: '0.72rem', color: C.mid }}>
                    mean <strong style={{ color: C.mid, fontFamily: MONO }}>{pct(f.mean_probability)}</strong>
                  </span>
                </>
              ) : (
                <span style={{ fontSize: '0.7rem', color: C.faint }}>not evaluated in this cycle</span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: '0.62rem', color: C.faint, fontFamily: MONO }}>
                {f.points} pts
              </span>
            </div>
          );
        })}
      </div>
      <p style={{ margin: '11px 0 0', fontSize: '0.66rem', color: C.faint, lineHeight: 1.55 }}>
        Every frame carries its own valid time and cycle. Frames from different cycles are never
        mixed, and nothing is interpolated to smooth the sequence.
      </p>
    </Panel>
  );
}

/* ── declared hazard layers ──────────────────────────────────────────────── */
function LayerGrid({ layers }) {
  if (!layers) return null;
  const available = layers.available || [];
  const missing = layers.missing || [];
  const required = new Set(layers.required || []);
  const all = [...available.map((n) => [n, true]), ...missing.map((n) => [n, false])];

  return (
    <Panel title={`Layers · ${available.length}/${all.length}`} icon={Activity} accent={C.green}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {all.map(([name, ok]) => (
          <span key={name} title={required.has(name) ? 'Required layer' : undefined} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px',
            borderRadius: 8, fontSize: '0.68rem', fontWeight: 600, fontFamily: MONO,
            color: ok ? C.text : C.red,
            background: ok ? 'rgba(74,222,128,0.07)' : 'rgba(248,113,113,0.09)',
            border: `1px solid ${ok ? 'rgba(74,222,128,0.22)' : 'rgba(248,113,113,0.3)'}`,
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%',
              background: ok ? C.green : C.red,
            }} />
            {name.replace(/_/g, ' ')}
            {required.has(name) && <span style={{ color: C.amber, fontWeight: 800 }}>*</span>}
          </span>
        ))}
      </div>
      <p style={{ margin: '11px 0 0', fontSize: '0.66rem', color: C.faint, lineHeight: 1.55 }}>
        Layers are declared up front, so a missing one is a detectable gap rather than an absence
        nobody noticed. <span style={{ color: C.amber }}>*</span> marks a required layer.
      </p>
    </Panel>
  );
}

/* ── the V5 platform's own viewer ────────────────────────────────────────────
   Imported wholesale from ukv-platform/frontend and served from /tcmv5. It is
   the real client — map, overlay picker, run controls, PNG renders — talking to
   the V5 service through the site's proxy, so it behaves exactly as it does on
   the platform itself rather than being a reimplementation that drifts from it.

   In an iframe on purpose. The viewer is a complete page with its own Leaflet
   instance, its own CSS and its own global state; dropping that into this
   React tree would mean merging two stylesheets and two ideas of what `body`
   means. The frame keeps both intact. */
export const V5_ORIGIN = 'http://127.0.0.1:8000';

/* The viewer gets the whole window.
 *
 * It used to sit in a rounded card under a page header and an intro paragraph,
 * which cost the map about 200px of height to tell you things the map itself
 * says better. The map is the subject, so it gets the screen; the only chrome
 * left is the engine switcher, floated in a corner over it. */
function V5Viewer() {
  return (
    <iframe
      title="TCM V5"
      /* Not /tcmv5: Windows serves files case-insensitively, so a folder of
         that name is handed out for the /TCMV5 route too and the React page
         never renders. */
      src="/tcm-v5-app/index.html"
      allow="fullscreen"
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%', border: 0, display: 'block',
      }}
    />
  );
}

/** Whether the V5 service is answering. The ported viewer is a client for it —
 *  with it down the map has nothing to draw, so the page says so plainly and
 *  falls back to the exported bundles, which need nothing running. */
function useV5Service() {
  const [up, setUp] = useState(null);
  const [checks, setChecks] = useState(0);
  useEffect(() => {
    let dead = false;
    fetch(`${V5_ORIGIN}/openapi.json`, { signal: AbortSignal.timeout(3000) })
      .then((r) => { if (!dead) setUp(r.ok); })
      .catch(() => { if (!dead) setUp(false); });
    return () => { dead = true; };
  }, [checks]);
  return [up, () => setChecks((n) => n + 1)];
}

function ServiceDown({ recheck }) {
  return (
    <Panel title="TCM V5 is not running" icon={AlertTriangle} accent={C.amber}
      style={{ borderColor: 'rgba(251,191,36,0.3)' }}>
      <p style={{ margin: '0 0 10px', color: C.mid, fontSize: '0.84rem', lineHeight: 1.62 }}>
        The map, the overlays and the run controls are the V5 platform's own front end, and it
        talks to the V5 service directly. That service is a Python process started by hand — it is
        not part of this website, and nothing here starts it for you.
      </p>
      <pre style={{
        margin: '0 0 12px', padding: '10px 12px', borderRadius: 10, overflowX: 'auto',
        background: 'rgba(2,6,15,0.55)', border: `1px solid ${C.border}`,
        fontFamily: MONO, fontSize: '0.7rem', color: C.text,
      }}>{'cd ukv-platform\n.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --port 8000'}</pre>
      <button type="button" onClick={recheck}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 13px',
          borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 700,
          background: 'rgba(56,189,248,0.14)', border: '1px solid rgba(56,189,248,0.4)', color: C.sky,
        }}>
        <RefreshCw style={{ width: 12, height: 12 }} /> Check again
      </button>
      <p style={{ margin: '14px 0 0', fontSize: '0.72rem', color: C.faint, lineHeight: 1.55 }}>
        The last exported cycles are below. Those are files, so they work whether or not the
        service is up.
      </p>
    </Panel>
  );
}

/* ── the V5 view ─────────────────────────────────────────────────────────── */
function TcmV5View() {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let dead = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch('/api/tcm-v5/product/latest')
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j.error || `HTTP ${r.status}`)))))
      .then((data) => { if (!dead) setState({ loading: false, error: null, data }); })
      .catch((err) => { if (!dead) setState({ loading: false, error: err.message, data: null }); });
    return () => { dead = true; };
  }, [reloads]);

  const points = useMemo(() => {
    const raw = state.data?.products?.point_probabilities || {};
    return Object.entries(raw)
      .map(([k, v]) => { const p = parsePointKey(k); return p ? { ...p, value: v } : null; })
      .filter(Boolean)
      .sort((a, b) => b.value - a.value);
  }, [state.data]);

  if (state.loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '60px 0', justifyContent: 'center', color: C.mid }}>
        <Loader2 style={{ width: 16, height: 16, animation: 'tcm-spin 0.9s linear infinite' }} />
        Loading the latest V5 cycle…
      </div>
    );
  }

  if (state.error) {
    return (
      <Panel title="No V5 forecast" icon={AlertTriangle} accent={C.red}
        style={{ borderColor: 'rgba(248,113,113,0.3)' }}>
        <p style={{ margin: 0, color: C.mid, fontSize: '0.82rem', lineHeight: 1.6 }}>
          {state.error}. V5 bundles are copied into the site from the platform's export directory —
          if none is present, nothing here has run yet.
        </p>
        <button type="button" onClick={() => setReloads((n) => n + 1)}
          style={{
            marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 13px',
            borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 700,
            background: 'rgba(56,189,248,0.14)', border: '1px solid rgba(56,189,248,0.4)', color: C.sky,
          }}>
          <RefreshCw style={{ width: 12, height: 12 }} /> Try again
        </button>
      </Panel>
    );
  }

  const { manifest, products, forecast_id: forecastId } = state.data;
  const meta = products?.summary?.metadata || {};
  const text = products?.summary?.text || '';
  const peak = points[0];
  const age = ageText(meta.generated_at);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Cycle identity */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 9 }}>
        <Tag tone="info">cycle {whenText(manifest?.cycle)}</Tag>
        {age && <Tag tone={/days/.test(age) ? 'warn' : 'neutral'}>{age}</Tag>}
        <Tag tone="neutral">v{meta.tcm_version || '5.0'}</Tag>
        <Tag tone="neutral" title={forecastId}>{meta.products_version || 'products'}</Tag>
      </div>

      <Provenance manifest={manifest} meta={meta} />

      {/* The headline: the peak number, and the outlook in words. */}
      <Panel title="The outlook" icon={Info} accent={C.sky}>
        {peak && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 13, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '2.6rem', fontWeight: 900, color: C.sky, fontFamily: MONO, lineHeight: 1 }}>
              {pct(peak.value)}
            </span>
            <span style={{ fontSize: '0.82rem', color: C.mid, lineHeight: 1.5 }}>
              highest thunderstorm probability anywhere in this cycle —<br />
              <strong style={{ color: C.text }}>{peak.place}</strong>, T+{peak.lead}
            </span>
          </div>
        )}
        <p style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.68, color: C.text }}>
          {text || 'This cycle produced no written summary.'}
        </p>
      </Panel>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <PointTable points={points} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FrameTimeline frames={products?.animation_frames?.frames} />
          <LayerGrid layers={products?.layers} />
        </div>
      </div>
    </div>
  );
}

/* ── page ────────────────────────────────────────────────────────────────── */
export default function TCMOutlooks({ forceEngine }) {
  const navigate = useNavigate();
  /* V5 is the default because the page is built around it. The choice sticks,
     so someone who works in V3 is not sent back to V5 on every visit — unless
     the URL names an engine, which outranks the preference. */
  const [engine, setEngineState] = useState(() => {
    if (forceEngine) return forceEngine;
    try { return localStorage.getItem('tcm_engine') === 'v3' ? 'v3' : 'v5'; } catch { return 'v5'; }
  });

  /* Choosing an engine changes the address, so the page can be linked to and
     the back button means something. */
  const setEngine = (next) => {
    setEngineState(next);
    navigate(next === 'v5' ? '/TCMV5' : '/TCMOutlooks');
  };
  useEffect(() => {
    try { localStorage.setItem('tcm_engine', engine); } catch { /* storage blocked */ }
  }, [engine]);

  const [serviceUp, recheck] = useV5Service();

  if (engine === 'v3') {
    return (
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: 14, right: 16, zIndex: 70 }}>
          <EngineSwitcher engine={engine} setEngine={setEngine} />
        </div>
        <WeatherPatterns embedded />
      </div>
    );
  }

  /* The viewer sits ON the page, with the site's own navigation above it as
     usual. It is given most of the window's height because the map is the
     subject, but it does not take the window over: going fullscreen is a
     button inside the viewer, and a choice. */
  if (serviceUp) {
    return (
      <div style={{ background: C.bg, color: C.text, padding: '10px 12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <span style={{
            fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: C.sky, fontFamily: MONO,
          }}>
            Thunderstorm Convective Model
          </span>
          <div style={{ marginLeft: 'auto' }}>
            <EngineSwitcher engine={engine} setEngine={setEngine} />
          </div>
        </div>
        <div style={{
          position: 'relative', borderRadius: 14, overflow: 'hidden',
          border: `1px solid ${C.border}`, background: '#0b0e13',
          height: 'calc(100vh - 132px)', minHeight: 520,
        }}>
          <V5Viewer />
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>
      <style>{`@keyframes tcm-spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '26px 16px 60px' }}>
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <p style={{
              margin: '0 0 5px', fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.18em',
              textTransform: 'uppercase', color: C.sky, fontFamily: MONO,
            }}>
              Thunderstorm Convective Model
            </p>
            <h1 style={{ margin: 0, fontSize: '1.9rem', fontWeight: 900, letterSpacing: '-0.02em', color: C.text }}>
              TCM Outlooks
            </h1>
            <p style={{ margin: '7px 0 0', fontSize: '0.84rem', color: C.mid, lineHeight: 1.55, maxWidth: 620 }}>
              A probabilistic convective forecast for the UK and Ireland, and everything
              needed to judge how much weight it will carry.
            </p>
          </div>
          <EngineSwitcher engine={engine} setEngine={setEngine} />
        </header>

        {serviceUp === null ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '50px 0', justifyContent: 'center', color: C.mid }}>
            <Loader2 style={{ width: 16, height: 16, animation: 'tcm-spin 0.9s linear infinite' }} />
            Looking for the TCM V5 service…
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ServiceDown recheck={recheck} />
            <TcmV5View />
          </div>
        )}
      </div>
    </div>
  );
}
