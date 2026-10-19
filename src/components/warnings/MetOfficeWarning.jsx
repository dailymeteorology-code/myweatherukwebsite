/* ════════════════════════════════════════════════════════════════════════════
   Met Office warning presentation, shared by the warning map and the warning
   cards: the official impact matrix, the warning detail panel laid out like the
   Met Office's own (headline, what to expect, further detail, why this colour,
   issued, regions and local authorities), the map name tag, and the geometry
   helpers both maps need.
   ════════════════════════════════════════════════════════════════════════════ */
import React from 'react';
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
        <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden><path d="M5 0 L10 8 H6 V12 H4 V8 H0 Z" fill={faint} /></svg>
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
        <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden><path d="M12 5 L4 0 V4 H0 V6 H4 V10 Z" fill={faint} /></svg>
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
const dd = (d) => d.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric' });
export function utcOffsetLabel(d) {
  const part = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, timeZoneName: 'shortOffset' })
    .formatToParts(d).find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  return part.replace('GMT', 'UTC').replace(/^UTC$/, 'UTC+0');
}

export const SEV_HEX = { Yellow: '#ffe629', Amber: '#ff9b00', Red: '#d1063b' };
const sevInk = (s) => (s === 'Red' ? '#fff' : '#111');

/* ── The detail panel ────────────────────────────────────────────────────── */
export function WarningDetailPanel({ warning: w, onClose, style }) {
  const hex = SEV_HEX[w.severity] || SEV_HEX.Yellow;
  const from = w.validFrom ? new Date(w.validFrom) : null;
  const to = w.validTo ? new Date(w.validTo) : null;
  const issued = w.issuedDate ? new Date(w.issuedDate) : null;
  const groups = groupAreas(w);
  const why = matrixSentence(w.likelihood, w.impactLevel);
  const H = { margin: '22px 0 10px', fontSize: 21, fontWeight: 800, color: '#fff' };
  const P = { margin: 0, fontSize: 15.5, lineHeight: 1.55, color: '#f3f4f6' };
  const UL = { margin: 0, paddingLeft: 22, listStyleType: 'square', display: 'flex', flexDirection: 'column', gap: 9 };
  return (
    <div style={{ background: '#2b2b2b', color: '#fff', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', ...style }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'stretch', background: hex, color: sevInk(w.severity), flex: 'none' }}>
        <div style={{ width: 64, display: 'grid', placeItems: 'center', background: '#2b2b2b' }}>
          <AlertTriangle style={{ width: 34, height: 34, color: hex }} fill={hex} stroke="#111" strokeWidth={1.6} />
        </div>
        <div style={{ flex: 1, padding: '10px 14px', lineHeight: 1.2 }}>
          <div style={{ fontWeight: 800, fontSize: 19 }}>{w.severity} warning</div>
          <div style={{ fontSize: 18 }}>{w.type}</div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close warning details"
            style={{ width: 62, border: 'none', cursor: 'pointer', background: 'rgba(0,0,0,0.14)', color: sevInk(w.severity), display: 'grid', placeItems: 'center' }}>
            <X style={{ width: 28, height: 28 }} strokeWidth={3} />
          </button>
        )}
      </div>
      {/* timeline */}
      {from && to && (
        <div style={{ background: '#111', padding: '10px 14px', display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', columnGap: 12, flex: 'none' }}>
          <div style={{ lineHeight: 1.35 }}><div style={{ fontSize: 15 }}>{hm(from)}</div><div style={{ fontWeight: 800, fontSize: 15 }}>{dd(from)}</div></div>
          <div style={{ textAlign: 'center' }}>
            <svg viewBox="0 0 100 6" preserveAspectRatio="none" style={{ width: '100%', height: 8, display: 'block' }} aria-hidden>
              <path d="M0 0 L98 0 L100 3 L98 6 L0 6 L2 3 Z" fill={hex} />
            </svg>
            <div style={{ fontSize: 11.5, marginTop: 6, color: '#e5e7eb' }}>{utcOffsetLabel(from)}</div>
          </div>
          <div style={{ lineHeight: 1.35, textAlign: 'right' }}><div style={{ fontSize: 15 }}>{hm(to)}</div><div style={{ fontWeight: 800, fontSize: 15 }}>{dd(to)}</div></div>
        </div>
      )}
      {/* body */}
      <div style={{ padding: '16px 18px 22px', overflowY: 'auto', minHeight: 0 }}>
        {w.description && <p style={P}>{w.description}</p>}
        {Array.isArray(w.whatToExpect) && w.whatToExpect.length > 0 && (
          <>
            <h3 style={H}>What should I expect?</h3>
            <ul style={UL}>{w.whatToExpect.map((t, i) => <li key={i} style={{ ...P, fontSize: 15 }}>{t}</li>)}</ul>
          </>
        )}
        {w.furtherDetails && (
          <>
            <h3 style={H}>Further detail</h3>
            {w.furtherDetails.split(/\n+/).filter(Boolean).map((t, i) => <p key={i} style={{ ...P, marginTop: i ? 10 : 0 }}>{t}</p>)}
          </>
        )}
        {(w.likelihood != null || w.impactLevel != null) && (
          <>
            <h3 style={H}>Why is the warning {String(w.severity || 'yellow').toLowerCase()}?</h3>
            {why && <p style={{ ...P, marginBottom: 16 }}>{why}</p>}
            <OfficialImpactMatrix likelihood={w.likelihood} impact={w.impactLevel} />
          </>
        )}
        {issued && (
          <>
            <h3 style={H}>Issued</h3>
            <p style={P}>{hm(issued)} ({utcOffsetLabel(issued)}) on {dd(issued)} {issued.toLocaleDateString('en-GB', { timeZone: TZ, month: 'short', year: 'numeric' })}</p>
          </>
        )}
        {groups.length > 0 && (
          <>
            <h3 style={H}>Regions and local authorities affected:</h3>
            {groups.map((g) => (
              <div key={g.region}>
                <h4 style={{ margin: '18px 0 10px', fontSize: 19, fontWeight: 800 }}>{g.region}</h4>
                {g.authorities.length > 0 && <ul style={UL}>{g.authorities.map((a) => <li key={a} style={{ ...P, fontSize: 15 }}>{a}</li>)}</ul>}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Map name tag: [Yellow] Wind › ───────────────────────────────────────── */
export function warningTagHtml(w) {
  const hex = SEV_HEX[w.severity] || SEV_HEX.Yellow;
  return `<div style="display:inline-flex;align-items:stretch;transform:translate(-50%,-50%);white-space:nowrap;font:700 14px Inter,system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.45);cursor:pointer">`
    + `<span style="background:${hex};color:${sevInk(w.severity)};padding:5px 9px">${w.severity}</span>`
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
