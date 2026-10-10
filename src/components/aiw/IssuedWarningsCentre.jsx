import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Search, X, RotateCcw, ChevronLeft, ChevronRight, Loader2, ArrowLeft, Zap } from 'lucide-react';
import { SEV, SEV_ORDER, aiwGet, fmtAt, fmtRemaining, fmtAgo, polygonPreviewPath, STATUS_LABEL } from './aiwClient';
import WarningDetail, { SevBadge } from './WarningDetail';

const STATUS_OPTS = [
  { id: 'active', label: 'Active' },
  { id: 'expired', label: 'Expired' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: '', label: 'All' },
];
const RECENT_OPTS = [
  { id: '', label: 'Any time' },
  { id: 'issued', label: 'Issued in last 2 h' },
  { id: 'updated', label: 'Updated in last 30 min' },
];
const SORT_OPTS = [
  { id: 'issued', label: 'Latest issued' },
  { id: 'severity', label: 'Severity' },
  { id: 'expiry', label: 'Expiry time' },
  { id: 'updated', label: 'Latest updated' },
];

const DEFAULTS = { status: 'active', severity: [], continent: '', country: '', admin1: '', admin2: '', q: '', recent: '', sort: 'severity', page: 1 };

function loadFilters() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('aiw_centre_filters') || '{}'), page: 1 }; } catch { return { ...DEFAULTS }; }
}

const selectStyle = {
  padding: '7px 9px', borderRadius: 10, fontSize: '0.74rem', fontFamily: 'inherit', minWidth: 0,
  background: 'var(--glass-fill)', color: 'var(--ink-1)', border: '1px solid var(--glass-hairline)',
};

function Chip({ on, onClick, children, color, ink, label }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} aria-label={label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit',
        fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap',
        background: on ? (color || 'var(--glass-fill-strong)') : 'var(--glass-fill)',
        color: on ? (ink || 'var(--ink-1)') : 'var(--ink-2)',
        border: `1.5px solid ${on ? (color || 'var(--ink-3)') : 'var(--glass-hairline)'}`,
      }}>{children}</button>
  );
}

/**
 * The Issued Warnings Centre: every AI lightning warning the system has
 * issued, current and historical, searchable and filterable by severity,
 * status, recency and geography (continent → country → region → county).
 * The geographical options come from the warnings themselves, so a filter
 * never offers an area there is nothing in.
 */
function IssuedWarningsCentre({ lightMode, isAdmin, selectedId, onSelect, onShowOnMap, refreshKey, coverage }) {
  const [f, setF] = useState(loadFilters);
  const [includeTest, setIncludeTest] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [qDraft, setQDraft] = useState(f.q);

  useEffect(() => { try { localStorage.setItem('aiw_centre_filters', JSON.stringify({ ...f, page: 1 })); } catch { /* ignore */ } }, [f]);
  useEffect(() => { const t = setTimeout(() => setF((p) => (p.q === qDraft ? p : { ...p, q: qDraft, page: 1 })), 300); return () => clearTimeout(t); }, [qDraft]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const j = await aiwGet('/warnings', {
        status: f.status, severity: f.severity, continent: f.continent, country: f.country,
        admin1: f.admin1, admin2: f.admin2, q: f.q, recent: f.recent, sort: f.sort, page: f.page, pageSize: 12,
        includeTest: includeTest ? 1 : undefined,
      });
      setData(j);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [f, includeTest]);
  useEffect(() => { load(); }, [load, refreshKey]);

  // A warning picked on the map opens here too.
  useEffect(() => { if (selectedId) setOpenId(selectedId); }, [selectedId]);

  const set = (patch) => setF((p) => ({ ...p, ...patch, page: patch.page ?? 1 }));
  const toggleSev = (k) => set({ severity: f.severity.includes(k) ? f.severity.filter((x) => x !== k) : [...f.severity, k] });
  const facets = data?.facets || { continents: [], countries: [], admin1: [], admin2: [] };
  const countries = useMemo(() => facets.countries.filter((c) => !f.continent || c.continent === f.continent), [facets, f.continent]);
  const admin1 = useMemo(() => facets.admin1.filter((a) => !f.country || a.country === f.country), [facets, f.country]);
  const admin2 = useMemo(() => facets.admin2.filter((a) => (!f.country || a.country === f.country) && (!f.admin1 || a.admin1 === f.admin1)), [facets, f.country, f.admin1]);
  const filtered = JSON.stringify({ ...f, page: 1 }) !== JSON.stringify({ ...DEFAULTS, page: 1 });
  const now = data?.now || Date.now();
  const openWarning = openId ? (data?.items || []).find((w) => w.id === openId) || { id: openId } : null;

  if (openWarning) {
    return (
      <div className="lg-pane" style={{ borderRadius: 20, padding: '14px 16px 16px' }}>
        <button type="button" onClick={() => { setOpenId(null); onSelect?.(null); }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '6px 11px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.74rem', fontWeight: 700, background: 'var(--glass-fill)', color: 'var(--ink-1)', border: '1px solid var(--glass-hairline)' }}>
          <ArrowLeft style={{ width: 13, height: 13 }} /> All issued warnings
        </button>
        <WarningDetail warning={openWarning} lightMode={lightMode} onShowOnMap={onShowOnMap} />
      </div>
    );
  }

  return (
    <div className="lg-pane" style={{ borderRadius: 20, overflow: 'hidden' }}>
      <div style={{ padding: '13px 16px 10px', borderBottom: '1px solid var(--glass-hairline)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <Zap style={{ width: 17, height: 17, color: '#FF9800' }} aria-hidden="true" />
          <h2 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink-1)' }}>Issued Warnings</h2>
          <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'rgba(255,152,0,0.14)', color: lightMode ? '#B05E00' : '#FF9800', border: '1px solid rgba(255,152,0,0.4)' }}>EXPERIMENTAL AI</span>
          <div style={{ flex: 1 }} />
          {loading && <Loader2 style={{ width: 14, height: 14, color: 'var(--ink-3)', animation: 'spin 0.9s linear infinite' }} aria-label="Loading" />}
          <span style={{ fontSize: '0.72rem', color: 'var(--ink-2)' }} aria-live="polite">
            {data ? `${data.total.toLocaleString()} matching warning${data.total === 1 ? '' : 's'}` : ''}
          </span>
        </div>

        {/* Severity (multi) + status */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }} role="group" aria-label="Severity">
          <Chip on={!f.severity.length} onClick={() => set({ severity: [] })}>All severities</Chip>
          {SEV_ORDER.slice().reverse().map((k) => {
            const s = SEV[k];
            const on = f.severity.includes(k);
            return (
              <Chip key={k} on={on} onClick={() => toggleSev(k)} color={s.color} ink={s.ink} label={`${s.label} warnings`}>
                <s.Icon style={{ width: 12, height: 12 }} aria-hidden="true" /> {s.label}
                {data?.counts && <span style={{ opacity: 0.75 }}>· {data.counts[k]}</span>}
              </Chip>
            );
          })}
          <span style={{ width: 1, background: 'var(--glass-hairline)', margin: '0 3px' }} />
          {STATUS_OPTS.map((o) => <Chip key={o.id || 'all'} on={f.status === o.id} onClick={() => set({ status: o.id })}>{o.label}</Chip>)}
        </div>

        {/* Geography, recency, search, sort */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 7, marginTop: 10 }}>
          <select aria-label="Continent" style={selectStyle} value={f.continent} onChange={(e) => set({ continent: e.target.value, country: '', admin1: '', admin2: '' })}>
            <option value="">Worldwide</option>
            {facets.continents.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.n})</option>)}
          </select>
          <select aria-label="Country" style={selectStyle} value={f.country} onChange={(e) => set({ country: e.target.value, admin1: '', admin2: '' })}>
            <option value="">All countries</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.n})</option>)}
          </select>
          <select aria-label="State, province or region" style={selectStyle} value={f.admin1} onChange={(e) => set({ admin1: e.target.value, admin2: '' })} disabled={!admin1.length}>
            <option value="">All regions</option>
            {admin1.map((a) => <option key={a.name} value={a.name}>{a.name} ({a.n})</option>)}
          </select>
          <select aria-label="County or district" style={selectStyle} value={f.admin2} onChange={(e) => set({ admin2: e.target.value })} disabled={!admin2.length}>
            <option value="">All counties / districts</option>
            {admin2.map((a) => <option key={a.name} value={a.name}>{a.name} ({a.n})</option>)}
          </select>
          <select aria-label="Recency" style={selectStyle} value={f.recent} onChange={(e) => set({ recent: e.target.value })}>
            {RECENT_OPTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <select aria-label="Sort by" style={selectStyle} value={f.sort} onChange={(e) => set({ sort: e.target.value })}>
            {SORT_OPTS.map((o) => <option key={o.id} value={o.id}>Sort: {o.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 7, marginTop: 7, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search style={{ position: 'absolute', left: 9, top: 9, width: 13, height: 13, color: 'var(--ink-3)' }} aria-hidden="true" />
            <input type="search" value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="Search a place, county, country or warning ID…" aria-label="Search warnings"
              style={{ ...selectStyle, width: '100%', paddingLeft: 28, boxSizing: 'border-box' }} />
          </div>
          {filtered && (
            <button type="button" onClick={() => { setF({ ...DEFAULTS }); setQDraft(''); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 11px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 700, background: 'var(--glass-fill)', color: 'var(--ink-1)', border: '1px solid var(--glass-hairline)' }}>
              <RotateCcw style={{ width: 12, height: 12 }} /> Reset filters
            </button>
          )}
          {isAdmin && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.7rem', color: 'var(--ink-2)' }}>
              <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} /> show test warnings
            </label>
          )}
        </div>
      </div>

      {err && <p style={{ margin: 14, fontSize: '0.78rem', color: '#F44336' }}>Could not load warnings: {err}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,300px),1fr))', gap: 9, padding: '12px 14px' }}>
        {(data?.items || []).map((w) => {
          const s = SEV[w.severity];
          const path = polygonPreviewPath(w.geometry);
          const active = w.status === 'active';
          return (
            <article key={w.id} style={{
              display: 'flex', flexDirection: 'column', gap: 7, padding: '11px 12px', borderRadius: 14,
              background: 'var(--glass-fill)', border: `1px solid var(--glass-hairline)`, borderLeft: `5px solid ${s.color}`,
              opacity: active ? 1 : 0.86,
            }}>
              <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <SevBadge severity={w.severity} isTest={w.isTest} />
                    <span style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: active ? (lightMode ? '#047857' : '#34d399') : 'var(--ink-3)' }}>
                      {STATUS_LABEL[w.status]}{active && w.state !== 'issued' ? ` · ${STATUS_LABEL[w.state] || w.state}` : ''}
                    </span>
                  </div>
                  <h3 style={{ margin: '6px 0 1px', fontSize: '0.84rem', fontWeight: 700, lineHeight: 1.3, color: 'var(--ink-1)' }}>{w.areaLabel}</h3>
                  <p style={{ margin: 0, fontSize: '0.68rem', color: 'var(--ink-2)' }}>
                    {(w.countries || []).join(', ')}{w.continents?.length ? ` · ${w.continents.join(', ')}` : ''}
                  </p>
                </div>
                {path && (
                  <svg width="64" height="44" viewBox="0 0 64 44" aria-hidden="true" style={{ flexShrink: 0, borderRadius: 8, background: 'var(--glass-fill-strong)' }}>
                    <path d={path} fill={`${s.color}55`} stroke={s.color} strokeWidth="1.5" />
                  </svg>
                )}
              </div>
              <p style={{ margin: 0, fontSize: '0.74rem', lineHeight: 1.45, color: 'var(--ink-1)' }}>{w.summary}</p>
              {!!w.places?.length && <p style={{ margin: 0, fontSize: '0.66rem', color: 'var(--ink-2)' }}>Including {w.places.slice(0, 5).join(', ')}</p>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 12px', fontSize: '0.64rem', color: 'var(--ink-2)', fontFamily: 'ui-monospace, monospace' }}>
                <span>Issued {fmtAt(w.issuedAt, w.tz)} {w.tzLabel}</span>
                <span>{active ? 'Until' : 'Due'} {fmtAt(w.expiresAt, w.tz)} {w.tzLabel}</span>
                {active && <span style={{ fontWeight: 800, color: 'var(--ink-1)' }}>{fmtRemaining(w.remainingMin)}</span>}
                {!active && w.endedAt && <span>{w.status === 'cancelled' ? 'Cancelled' : 'Ended'} {fmtAgo(w.endedAt, now)}</span>}
                <span>Updated {fmtAgo(w.updatedAt || w.issuedAt, now)}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                <button type="button" onClick={() => { setOpenId(w.id); onSelect?.(w.id); }}
                  style={{ flex: 1, padding: '6px 10px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 700, background: 'var(--glass-fill-strong)', color: 'var(--ink-1)', border: '1px solid var(--glass-hairline)' }}>
                  Open warning
                </button>
                {active && (
                  <button type="button" onClick={() => onShowOnMap?.(w)}
                    style={{ padding: '6px 10px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 700, background: s.color, color: s.ink, border: 'none' }}>
                    Show on map
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {data && !data.items.length && (
          <div style={{ gridColumn: '1 / -1', padding: '18px 6px', textAlign: 'center', fontSize: '0.8rem', color: 'var(--ink-2)', lineHeight: 1.55 }}>
            {f.status === 'active' && !filtered
              ? 'No AI lightning warnings are active right now.'
              : 'No warnings match these filters.'}
            <br />
            <span style={{ fontSize: '0.7rem', color: 'var(--ink-3)' }}>
              No warning is not the same as no risk — and warnings are only issued where the lightning network can see storms
              {coverage ? ` (good coverage: ${coverage.filter((c) => c.quality === 'good').map((c) => c.id.replace('-', ' ')).join(', ')}; partial: ${coverage.filter((c) => c.quality === 'partial').map((c) => c.id.replace('-', ' ')).join(', ')})` : ''}.
            </span>
          </div>
        )}
      </div>

      {data && data.pages > 1 && (
        <nav aria-label="Pages" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '0 14px 14px' }}>
          <button type="button" disabled={f.page <= 1} onClick={() => set({ page: f.page - 1 })} aria-label="Previous page"
            style={{ ...selectStyle, cursor: f.page <= 1 ? 'default' : 'pointer', opacity: f.page <= 1 ? 0.5 : 1, display: 'flex', alignItems: 'center' }}><ChevronLeft style={{ width: 14, height: 14 }} /></button>
          <span style={{ fontSize: '0.74rem', color: 'var(--ink-2)' }}>Page {f.page} of {data.pages}</span>
          <button type="button" disabled={f.page >= data.pages} onClick={() => set({ page: f.page + 1 })} aria-label="Next page"
            style={{ ...selectStyle, cursor: f.page >= data.pages ? 'default' : 'pointer', opacity: f.page >= data.pages ? 0.5 : 1, display: 'flex', alignItems: 'center' }}><ChevronRight style={{ width: 14, height: 14 }} /></button>
        </nav>
      )}
    </div>
  );
}

export { X };
export default React.memo(IssuedWarningsCentre);
