/* Warnings on the Lightning page that are not its own AI warnings:
     • Met Office warnings: read from the cached record the home page's warnings panel uses, so the
       map and that panel always agree, drawn from each warning's own shape
     • worldwide alerts: every national weather service's live CAP warnings (server/worldWarnings.js)
   and the movable panel a clicked warning opens in over the map. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Globe, GripVertical, Loader2, Search, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';

/* ── Met Office ─────────────────────────────────────────────────────────── */

export const MO_LEVEL = {
  Red: { color: '#ef4444', fillOpacity: 0.42, weight: 2.4, dash: null },
  Amber: { color: '#f97316', fillOpacity: 0.36, weight: 2.2, dash: null },
  Yellow: { color: '#facc15', fillOpacity: 0.28, weight: 2.0, dash: null },
  Future: { color: '#94a3b8', fillOpacity: 0.10, weight: 1.5, dash: '5, 4' },
};

export async function fetchMetOfficeWarnings() {
  try {
    const rec = (await base44.entities.CachedWarnings.list())?.[0];
    if (rec?.all_warnings?.length) return rec.all_warnings;
  } catch { /* fall through */ }
  try {
    const r = await base44.functions.invoke('getMetOfficeWarnings', {});
    const list = r?.data?.all_warnings || r?.all_warnings;
    if (Array.isArray(list)) return list;
  } catch { /* none */ }
  return [];
}

const fmtDT = (d) => (d ? new Date(d).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const dur = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);

export function MetOfficeDetail({ w }) {
  const now = Date.now();
  const from = w.validFrom ? Date.parse(w.validFrom) : null;
  const to = w.validTo ? Date.parse(w.validTo) : null;
  const future = from && from > now;
  const cfg = MO_LEVEL[future ? 'Future' : w.severity] || MO_LEVEL.Yellow;
  const regions = Array.isArray(w.regions) ? w.regions.join(', ') : w.region || '';
  return (
    <div className="lx-detail">
      <div className="lx-detail-head">
        <i style={{ background: cfg.color }} />
        <div>
          <b>{w.severity} {w.type || 'weather'} warning</b>
          {regions && <span>{regions}</span>}
        </div>
        <em style={{ color: cfg.color, borderColor: `${cfg.color}66`, background: `${cfg.color}1f` }}>{future ? 'Upcoming' : 'In force'}</em>
      </div>
      {w.description && <p>{w.description}</p>}
      <dl>
        <dt>From</dt><dd>{fmtDT(w.validFrom)}</dd>
        <dt>Until</dt><dd>{fmtDT(w.validTo)}</dd>
        {to && <><dt>{future ? 'Starts' : 'Ends'}</dt><dd>{future ? `in ${dur(Math.round((from - now) / 60000))}` : `in ${dur(Math.max(0, Math.round((to - now) / 60000)))}`}</dd></>}
      </dl>
      {w.impacts && <p className="lx-muted">{w.impacts}</p>}
      <a className="lx-link" href="https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings" target="_blank" rel="noopener noreferrer">View on the Met Office website</a>
      <p className="lx-fine">© Crown copyright, Met Office</p>
    </div>
  );
}

/* ── worldwide ──────────────────────────────────────────────────────────── */

/* CAP's own five-level scale, which every national service publishes against. */
export const WORLD_SEV = {
  Extreme: { color: '#ef4444' }, Severe: { color: '#f97316' }, Moderate: { color: '#facc15' },
  Minor: { color: '#38bdf8' }, Unknown: { color: '#94a3b8' },
};
const WORLD_ORDER = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];

function relWhen(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return null;
  const m = Math.round(Math.abs(ms) / 60000);
  const t = m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} days`;
  return ms >= 0 ? `in ${t}` : `${t} ago`;
}
const withRel = (iso) => (iso ? `${fmtDT(iso)}${relWhen(iso) ? ` (${relWhen(iso)})` : ''}` : null);

export function WorldAlertDetail({ w, detail }) {
  const sev = WORLD_SEV[w.severity] || WORLD_SEV.Unknown;
  const d = detail && detail.ok !== false ? detail : null;
  return (
    <div className="lx-detail">
      <div className="lx-detail-head">
        <i style={{ background: sev.color }} />
        <div>
          <b>{w.event}</b>
          <span>{w.sender || d?.senderName || w.source}{w.country ? ` · ${w.country}` : ''}</span>
        </div>
        <em style={{ color: sev.color, borderColor: `${sev.color}66`, background: `${sev.color}1f` }}>{w.severity}</em>
      </div>
      {w.headline && <p>{w.headline}</p>}
      <dl>
        {withRel(d?.onset || d?.effective || w.effective) && <><dt>Starts</dt><dd>{withRel(d?.onset || d?.effective || w.effective)}</dd></>}
        {withRel(d?.expires || w.expires) && <><dt>Ends</dt><dd>{withRel(d?.expires || w.expires)}</dd></>}
        {(d?.areaDesc || w.areaDesc) && <><dt>Area</dt><dd>{d?.areaDesc || w.areaDesc}</dd></>}
        {(d?.urgency || w.urgency) && <><dt>Urgency</dt><dd>{d?.urgency || w.urgency}</dd></>}
        {(d?.certainty || w.certainty) && <><dt>Certainty</dt><dd>{d?.certainty || w.certainty}</dd></>}
      </dl>
      <h4>Description</h4>
      {d?.description ? <p className="lx-pre">{d.description}</p>
        : detail === null ? <p className="lx-muted">Loading the full alert…</p>
          : <p className="lx-muted">{detail?.missing ? 'The issuing service has already withdrawn the full text; the summary above is what the WMO index still holds.' : 'The full text could not be loaded from the issuing service.'}</p>}
      {d?.instruction && <><h4>Advice</h4><p className="lx-pre">{d.instruction}</p></>}
      {d?.web && <a className="lx-link" href={d.web} target="_blank" rel="noopener noreferrer">Open at the issuing service</a>}
    </div>
  );
}

/** The full list: the map can only draw alerts that publish a shape, so every one is listed here. */
export function WorldAlertsList({ data, loading, onOpen }) {
  const [query, setQuery] = useState('');
  const [sev, setSev] = useState('all');
  const [limit, setLimit] = useState(60);
  useEffect(() => { setLimit(60); }, [query, sev]);
  const all = useMemo(() => data?.warnings || [], [data]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((w) => (sev === 'all' || w.severity === sev)
      && (!q || [w.event, w.areaDesc, w.headline, w.country, w.sender].some((x) => (x || '').toLowerCase().includes(q))));
  }, [all, query, sev]);
  const counts = data?.counts?.bySeverity || {};
  return (
    <div className="lx-world">
      <div className="lx-world-head">
        <Globe size={15} />
        <b>Worldwide alerts</b>
        {loading && <Loader2 size={13} className="lx-spin" />}
        <span>{data?.counts?.total ? `${data.counts.total.toLocaleString()} in force · ${Object.keys(data.counts.byCountry || {}).length} countries` : loading ? 'loading…' : 'none'}</span>
      </div>
      <label className="lx-search"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search event, area, country…" aria-label="Search worldwide alerts" /></label>
      <div className="lx-chips">
        <button type="button" className="lx-chip" aria-pressed={sev === 'all'} onClick={() => setSev('all')}>All</button>
        {WORLD_ORDER.filter((s) => counts[s]).map((s) => (
          <button key={s} type="button" className="lx-chip" aria-pressed={sev === s} onClick={() => setSev(s)}>
            <i style={{ background: WORLD_SEV[s].color }} />{s} · {counts[s]}
          </button>
        ))}
      </div>
      {data?.counts?.total > 0 && <p className="lx-fine">{data.counts.drawn.toLocaleString()} publish a shape and are drawn on the map; the rest give their area in words or national codes, and all are listed here.</p>}
      <div className="lx-world-list">
        {shown.slice(0, limit).map((w) => (
          <button key={w.id} type="button" className="lx-world-row" onClick={() => onOpen(w)}>
            <i style={{ background: (WORLD_SEV[w.severity] || WORLD_SEV.Unknown).color }} />
            <span>
              <b>{w.event}</b>
              <span>{w.country ? `${w.country} · ` : ''}{w.areaDesc || w.sender || '—'}</span>
              <em>{w.geometry ? 'on the map · ' : ''}ends {relWhen(w.expires) || '—'}</em>
            </span>
          </button>
        ))}
        {!shown.length && !loading && <p className="lx-muted">{all.length ? 'No alerts match that search.' : 'No worldwide alerts right now.'}</p>}
      </div>
      {shown.length > limit && <button type="button" className="lx-more" onClick={() => setLimit((l) => l + 120)}>Show more ({(shown.length - limit).toLocaleString()} left)</button>}
    </div>
  );
}

/* ── the movable panel over the map ─────────────────────────────────────── */

const BOX_KEY = 'lx_panel_box_v2';
const MIN_W = 240, MIN_H = 170, DEF = { x: null, y: 70, w: 340, h: 400 };
const loadBox = () => { try { const b = JSON.parse(localStorage.getItem(BOX_KEY) || 'null'); if (b && Number.isFinite(b.w)) return { ...DEF, ...b }; } catch { /* default */ } return { ...DEF }; };

/** Drag it by its title bar, resize it from its corner (double-click the corner to reset); it
 *  stays where it was put, across warnings and visits. Esc closes it. */
export function MapPanel({ title, accent = '#38bdf8', onClose, children }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const [box, setBox] = useState(loadBox);
  const fit = (b, host) => {
    const w = Math.min(Math.max(MIN_W, b.w), Math.max(MIN_W, host.clientWidth - 24));
    const h = Math.min(Math.max(MIN_H, b.h), Math.max(MIN_H, host.clientHeight - 90));
    const x = b.x == null ? host.clientWidth - w - 14 : Math.min(Math.max(8, b.x), Math.max(8, host.clientWidth - w - 8));
    const y = Math.min(Math.max(62, b.y), Math.max(62, host.clientHeight - h - 70));
    return { x, y, w, h };
  };
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return undefined;
    setBox((b) => fit(b, host));
    const ro = new ResizeObserver(() => setBox((b) => fit(b, host)));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const save = (b) => { try { localStorage.setItem(BOX_KEY, JSON.stringify(b)); } catch { /* fine */ } };
  const start = (mode) => (e) => {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest?.('button, a, input')) return;
    e.preventDefault(); e.stopPropagation();
    drag.current = { mode, x: e.clientX, y: e.clientY, box: { ...box }, host: ref.current?.parentElement };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    setBox(fit(d.mode === 'move' ? { ...d.box, x: d.box.x + dx, y: d.box.y + dy } : { ...d.box, w: d.box.w + dx, h: d.box.h + dy }, d.host));
  };
  const end = (e) => { if (!drag.current) return; drag.current = null; e.currentTarget.releasePointerCapture?.(e.pointerId); setBox((b) => { save(b); return b; }); };
  return (
    <div ref={ref} className="lx-panel" style={{ left: box.x ?? undefined, right: box.x == null ? 14 : undefined, top: box.y, width: box.w, height: box.h, '--accent': accent }}
      onWheel={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="lx-panel-bar" onPointerDown={start('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <GripVertical size={13} />
        <span>{title}</span>
        <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)"><X size={13} /></button>
      </div>
      <div className="lx-panel-body">{children}</div>
      <div className="lx-panel-grip" title="Drag to resize · double-click to reset" onPointerDown={start('size')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        onDoubleClick={() => setBox((b) => { const n = { ...b, w: DEF.w, h: DEF.h }; save(n); return n; })}>
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true"><path d="M10 2 L2 10 M10 6 L6 10" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" /></svg>
      </div>
    </div>
  );
}
