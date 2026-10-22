/* ════════════════════════════════════════════════════════════════════════════
   Met Office warning presentation, shared by the warning map, the warnings
   archive and the warning cards: the official impact matrix, the warning detail
   in liquid glass (severity, period, what to expect, further detail, why this
   colour, issued, regions and local authorities, in the Met Office's order), the
   map name tag, and the geometry helpers both maps need.
   ════════════════════════════════════════════════════════════════════════════ */
import React from 'react';
import './warnings-glass.css';
import { X, AlertTriangle, Check } from 'lucide-react';

/* ── Official matrix ─────────────────────────────────────────────────────────
   Rows are likelihood (Very High at the top), columns impact (Minor on the
   left). Cell colours and the matrix itself are the Met Office's. */
export const LIKELIHOOD = [null, ['Low', '10-25%'], ['Medium', '25-50%'], ['High', '50-75%'], ['Very High', '>75%']];
export const IMPACT = [null, 'Minor', 'Moderate', 'Significant', 'Extreme'];
const M = { G: '#c5e510', Y: '#ffe629', A: '#ff9b00', R: '#d1063b' };
const MATRIX = {
  4: ['G', 'Y', 'A', 'R'],
  3: ['G', 'Y', 'A', 'A'],
  2: ['G', 'G', 'Y', 'A'],
  1: ['G', 'G', 'Y', 'Y'],
};

export function OfficialImpactMatrix({ likelihood, impact, ink = '#fff', faint = '#9ca3af' }) {
  const L = Number(likelihood), I = Number(impact);
  const has = L >= 1 && L <= 4 && I >= 1 && I <= 4;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '22px auto 1fr', gridTemplateRows: '1fr auto auto', columnGap: 6, maxWidth: 440 }}>
      {/* vertical axis */}
      <div style={{ gridRow: '1 / 2', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden><path d="M5 0 L10 8 H6 V12 H4 V8 H0 Z" style={{ fill: faint }} /></svg>
        <div style={{ flex: 1, width: 1.5, background: faint }} />
        <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', color: faint, fontSize: 14, margin: '8px 0' }}>Likelihood</span>
        <div style={{ flex: 1, width: 1.5, background: faint }} />
      </div>
      {/* row labels */}
      <div style={{ display: 'grid', gridTemplateRows: 'repeat(4, 1fr)', gap: 2 }}>
        {[4, 3, 2, 1].map((l) => (
          <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: ink, fontSize: 14, lineHeight: 1.2, padding: '0 8px' }}>
            <span style={{ whiteSpace: 'nowrap' }}>{LIKELIHOOD[l][0]}</span><span>{LIKELIHOOD[l][1]}</span>
          </div>
        ))}
      </div>
      {/* cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridTemplateRows: 'repeat(4, 1fr)', gap: 2 }}>
        {[4, 3, 2, 1].map((l) => [1, 2, 3, 4].map((i) => {
          const on = has && l === L && i === I;
          return (
            <div key={`${l}${i}`} title={`${LIKELIHOOD[l][0]} likelihood, ${IMPACT[i].toLowerCase()} impact`}
              style={{ aspectRatio: '1 / 1', minHeight: 44, background: M[MATRIX[l][i - 1]], display: 'grid', placeItems: 'center' }}>
              {on && <Check style={{ width: 22, height: 22, color: '#111' }} strokeWidth={2.4} />}
            </div>
          );
        }))}
      </div>
      {/* column labels + horizontal axis */}
      <div style={{ gridColumn: '3 / 4', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, marginTop: 10 }}>
        {[1, 2, 3, 4].map((i) => <span key={i} style={{ color: ink, fontSize: 14, textAlign: 'center' }}>{IMPACT[i]}</span>)}
      </div>
      <div style={{ gridColumn: '3 / 4', display: 'flex', alignItems: 'center', marginTop: 12 }}>
        <div style={{ flex: 1, height: 1.5, background: faint }} />
        <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden><path d="M12 5 L4 0 V4 H0 V6 H4 V10 Z" style={{ fill: faint }} /></svg>
      </div>
      <div style={{ gridColumn: '3 / 4', textAlign: 'center', color: faint, fontSize: 14, marginTop: 2 }}>Impact</div>
      {!has && (
        <div style={{ gridColumn: '1 / 4', fontSize: 12, color: faint, marginTop: 8 }}>
          The Met Office did not publish a likelihood and impact for this warning.
        </div>
      )}
    </div>
  );
}

export function matrixSentence(likelihood, impact) {
  const L = LIKELIHOOD[Number(likelihood)], I = IMPACT[Number(impact)];
  if (!L || !I) return null;
  return `This warning has a ${L[0].toLowerCase()} (${L[1]}) likelihood and a ${I.toLowerCase()} impact.`;
}

/* ── Regions and local authorities ───────────────────────────────────────────
   The feed lists each region followed by its local authorities. Older cached
   warnings carry only that flat list, so it is regrouped on the known region
   names. */
const MO_REGIONS = [
  'Orkney & Shetland', 'Highlands & Eilean Siar', 'Grampian', 'Strathclyde', 'Central, Tayside & Fife',
  'SW Scotland, Lothian Borders', 'Northern Ireland', 'Wales', 'North West England', 'North East England',
  'Yorkshire & Humber', 'West Midlands', 'East Midlands', 'East of England', 'South West England',
  'London & South East England',
];
const REGION_SET = new Set(MO_REGIONS.map((r) => r.toLowerCase()));
export function groupAreas(w) {
  if (Array.isArray(w.areas) && w.areas.length) return w.areas;
  const out = [];
  for (const name of w.regions || []) {
    if (REGION_SET.has(String(name).toLowerCase()) || !out.length) out.push({ region: name, authorities: [] });
    else out[out.length - 1].authorities.push(name);
  }
  return out;
}

/* ── Time ────────────────────────────────────────────────────────────────── */
const TZ = 'Europe/London';
const hm = (d) => d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export function utcOffsetLabel(d) {
  const part = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, timeZoneName: 'shortOffset' })
    .formatToParts(d).find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  return part.replace('GMT', 'UTC').replace(/^UTC$/, 'UTC+0');
}

export const SEV_HEX = { Yellow: '#ffe629', Amber: '#ff9b00', Red: '#d1063b' };

/* ── The detail ─────────────────────────────────────────────────────────────
   Glass, inside a .wg pop-up (it takes that pop-up's light or dark ink). The panel is the
   severity badge, the period and the body; the body alone is what an archive card opens into. */
export const sevInkOn = (s) => (s === 'Red' ? '#fff' : '#111');
const durationText = (from, to) => {
  const h = Math.round((to - from) / 36e5);
  if (!Number.isFinite(h) || h <= 0) return null;
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ''}`;
};
const longDay = (d) => d.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });

export function WarningDetailBody({ warning: w, flat = false, children }) {
  const issued = w.issuedDate ? new Date(w.issuedDate) : null;
  const groups = groupAreas(w);
  const why = matrixSentence(w.likelihood, w.impactLevel);
  const expect = Array.isArray(w.whatToExpect) ? w.whatToExpect.filter(Boolean) : [];
  return (
    <div className={`wg-d-body${flat ? ' is-flat' : ''}`} style={{ '--wg-sev': SEV_HEX[w.severity] || SEV_HEX.Yellow }}>
      {children}
      {w.description && <p className="wg-d-lead" style={{ marginTop: children ? 14 : 8 }}>{w.description}</p>}
      {expect.length > 0 && (
        <>
          <h3>What to expect</h3>
          <ul className="wg-d-list">{expect.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </>
      )}
      {w.furtherDetails && (
        <>
          <h3>Further detail</h3>
          {w.furtherDetails.split(/\n+/).filter(Boolean).map((t, i) => <p key={i} className="wg-d-soft">{t}</p>)}
        </>
      )}
      {(w.likelihood != null || w.impactLevel != null) && (
        <>
          <h3>Why it is {String(w.severity || 'yellow').toLowerCase()}</h3>
          {why && <p className="wg-d-soft" style={{ marginBottom: 12 }}>{why}</p>}
          <div className="wg-d-matrix"><OfficialImpactMatrix likelihood={w.likelihood} impact={w.impactLevel} ink="var(--wg-ink1)" faint="var(--wg-ink3)" /></div>
        </>
      )}
      {issued && (
        <>
          <h3>Issued</h3>
          <p className="wg-d-soft">{hm(issued)} ({utcOffsetLabel(issued)}) on {longDay(issued)} {issued.toLocaleDateString('en-GB', { timeZone: TZ, year: 'numeric' })}{w.warningVersion && w.warningVersion !== '1.0' ? ` · version ${w.warningVersion}` : ''}</p>
        </>
      )}
      {groups.length > 0 && (
        <>
          <h3>Regions and local authorities</h3>
          {groups.map((g) => (
            <div key={g.region} className="wg-d-region">
              <b>{g.region}</b>
              {g.authorities.length > 0 && <div className="wg-d-chips">{g.authorities.map((a) => <span key={a}>{a}</span>)}</div>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* `actions`: extra buttons for the head, before the close button (the map's "Save JPG") */
export function WarningDetailPanel({ warning: w, onClose, style, actions = null }) {
  const hex = SEV_HEX[w.severity] || SEV_HEX.Yellow;
  const from = w.validFrom ? new Date(w.validFrom) : null;
  const to = w.validTo ? new Date(w.validTo) : null;
  const dur = from && to ? durationText(from, to) : null;
  return (
    <div className="wg-d" style={style}>
      <div className="wg-d-head">
        <span className="wg-d-badge" style={{ background: hex, color: sevInkOn(w.severity) }}>
          <AlertTriangle fill="currentColor" fillOpacity={0.18} strokeWidth={2.2} />
        </span>
        <div className="wg-d-title"><b>{w.severity} warning</b><span>{w.type}</span></div>
        {actions}
        {onClose && (
          <button type="button" className="wg-btn wg-icon" onClick={onClose} aria-label="Close warning details"><X /></button>
        )}
      </div>
      {from && to && (
        <div className="wg-d-time">
          <div><b>{hm(from)}</b><small>{longDay(from)}</small></div>
          <div>
            <div className="wg-d-bar" style={{ background: `linear-gradient(90deg, ${hex}99, ${hex})` }} />
            <span className="wg-d-dur">{dur ? `${dur} · ` : ''}{utcOffsetLabel(from)}</span>
          </div>
          <div style={{ textAlign: 'right' }}><b>{hm(to)}</b><small>{longDay(to)}</small></div>
        </div>
      )}
      <WarningDetailBody warning={w} />
    </div>
  );
}

/* ── Map name tag: [Yellow] Wind › ───────────────────────────────────────── */
export function warningTagHtml(w) {
  const hex = SEV_HEX[w.severity] || SEV_HEX.Yellow;
  return `<div style="display:inline-flex;align-items:stretch;transform:translate(-50%,-50%);white-space:nowrap;font:700 14px Inter,system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.45);cursor:pointer">`
    + `<span style="background:${hex};color:${sevInkOn(w.severity)};padding:5px 9px">${w.severity}</span>`
    + `<span style="background:#2b2111;color:#fff;padding:5px 9px;display:inline-flex;align-items:center;gap:6px">${w.type}<svg width="8" height="12" viewBox="0 0 8 12"><path d="M1.5 1 L6.5 6 L1.5 11" stroke="#fff" stroke-width="2" fill="none"/></svg></span></div>`;
}

/* ── Geometry ────────────────────────────────────────────────────────────── */
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Is (lat, lon) inside any of these GeoJSON Polygon/MultiPolygon geometries? Holes respected. */
export function insideGeometries(geoms, lat, lon) {
  for (const g of geoms || []) {
    const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    for (const rings of polys) {
      if (!rings?.length || !inRing(lon, lat, rings[0])) continue;
      if (!rings.slice(1).some((h) => inRing(lon, lat, h))) return true;
    }
  }
  return false;
}
