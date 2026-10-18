/* ════════════════════════════════════════════════════════════════════════════
   TCM OUTLOOKS
   ────────────────────────────────────────────────────────────────────────────
   Two engines behind one page: TCM NOVA (the thunderstorm model, see
   TCMNova.jsx — it replaced TCM V5 here) and TCM V3, rendered unchanged under
   its own tab because it still works.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Layers, ChevronDown, AlertTriangle, Clock, MapPin, Activity,
  ShieldAlert, Loader2, RefreshCw, Info,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import WeatherPatterns from './WeatherPatterns';
import TCMNova from './TCMNova';
import { isCurrentUserAdmin } from '@/lib/tcmFetchPolicy';

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
  const [admin, setAdmin] = useState(false);
  useEffect(() => { isCurrentUserAdmin().then((a) => setAdmin(!!a)).catch(() => {}); }, []);
  const row = (id, name, blurb, tone, tag) => {
    const on = engine === id;
    const locked = id === 'nova' && !admin;
    return (
      <button key={id} type="button" disabled={locked} title={locked ? 'TCM NOVA — coming soon' : undefined}
        onClick={() => { if (!locked) { setEngine(id); setOpen(false); } }}
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
        TCM {engine === 'nova' ? 'NOVA' : engine.toUpperCase()}
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
          {row('nova', admin ? 'TCM NOVA' : '🔒 TCM NOVA', admin ? 'The thunderstorm model: 2 km Main Run and 1.5 km Hyper-Short. (Admin preview)' : 'Coming soon.', 'warn', admin ? 'admin' : 'soon')}
          {row('v3', 'TCM V3', 'The risk-area map. Drawn outlooks over the whole country.', 'neutral', 'live')}
        </div>
      )}
    </div>
  );
}

export default function TCMOutlooks({ forceEngine }) {
  const navigate = useNavigate();
  /* V5 is the default because the page is built around it. The choice sticks,
     so someone who works in V3 is not sent back to V5 on every visit — unless
     the URL names an engine, which outranks the preference. */
  const [engine, setEngineState] = useState(() => {
    if (forceEngine) return forceEngine;
    try { return localStorage.getItem('tcm_engine') === 'nova' ? 'nova' : 'v3'; } catch { return 'v3'; }   // V3 is the public default
  });

  /* Choosing an engine changes the address, so the page can be linked to and
     the back button means something. */
  const setEngine = (next) => {
    setEngineState(next);
    navigate(next === 'nova' ? '/TCMNova' : '/TCMOutlooks');
  };
  useEffect(() => {
    try { localStorage.setItem('tcm_engine', engine); } catch { /* storage blocked */ }
  }, [engine]);

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

  /* TCM NOVA replaces TCM V5 on this page. */
  return <TCMNova engineSwitcher={<EngineSwitcher engine={engine} setEngine={setEngine} />} onUseV3={() => setEngine('v3')} />;
}
