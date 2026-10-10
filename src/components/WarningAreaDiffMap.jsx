/* ════════════════════════════════════════════════════════════════════════════
   WARNING AREA — BEFORE vs NOW
   ────────────────────────────────────────────────────────────────────────────
   When the Met Office amends a live warning it very often redraws the area
   rather than changing any wording, and a list of changed field names cannot
   convey "it now reaches fifty miles further north". This draws the old outline
   against the new one so the change is visible at a glance.

   IT NEVER SHOWS A SILENT GREY BOX. Loading, a failed map library, and "we have
   no earlier outline on record" are three different states and each says which
   one it is — an empty map is indistinguishable from a broken one, which was
   the original warning map's whole problem.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { ensureLeaflet } from '@/lib/leafletLoader';
import { toLatLngs, areaKm2 } from '@/lib/warningArea';

const PREV_COLOUR = '#94a3b8';

/* One shared empty array for the default props. A fresh `[]` per render would
   change the effect's dependencies every time, and the card re-renders once a
   second for its countdown — the map would be torn down and rebuilt on every
   tick. */
const NONE = [];

export default function WarningAreaDiffMap({
  before = NONE,
  after = NONE,
  severityHex = '#facc15',
  isDark = true,
  height = 230,
}) {
  const holder = useRef(null);
  const mapRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error

  const hasBefore = Array.isArray(before) && before.length > 0;
  const hasAfter = Array.isArray(after) && after.length > 0;

  useEffect(() => {
    let dead = false;

    ensureLeaflet().then((L) => {
      if (dead || !holder.current) return;

      const map = mapRef.current || L.map(holder.current, {
        zoomControl: false, attributionControl: false,
        scrollWheelZoom: false, dragging: false,
        doubleClickZoom: false, boxZoom: false, keyboard: false,
        touchZoom: false,
      });
      if (!mapRef.current) {
        L.tileLayer(
          isDark
            ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
            : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
          { maxZoom: 12, subdomains: 'abcd' },
        ).addTo(map);
        mapRef.current = map;
      }

      const drawn = [];
      // Previous first, so the current area sits on top of it.
      if (hasBefore) {
        before.flatMap(toLatLngs).forEach((rings) => {
          drawn.push(L.polygon(rings, {
            color: PREV_COLOUR, weight: 2, opacity: 0.95, dashArray: '5 4',
            fill: true, fillColor: PREV_COLOUR, fillOpacity: 0.1,
          }).addTo(map));
        });
      }
      if (hasAfter) {
        after.flatMap(toLatLngs).forEach((rings) => {
          drawn.push(L.polygon(rings, {
            color: severityHex, weight: 2.5, opacity: 1,
            fill: true, fillColor: severityHex, fillOpacity: 0.3,
          }).addTo(map));
        });
      }

      if (drawn.length) {
        const bounds = drawn.reduce((acc, l) => acc ? acc.extend(l.getBounds()) : l.getBounds(), null);
        if (bounds?.isValid()) map.fitBounds(bounds, { padding: [18, 18] });
      }

      setStatus('ready');
      // The panel is still expanding when this runs, so the container measures
      // zero and Leaflet renders a blank tile grid until it is told to re-read.
      setTimeout(() => { try { map.invalidateSize(); } catch { /* unmounted */ } }, 240);
    }).catch(() => { if (!dead) setStatus('error'); });

    return () => {
      dead = true;
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch { /* already gone */ }
        mapRef.current = null;
      }
    };
  }, [before, after, severityHex, isDark, hasBefore, hasAfter]);

  const beforeKm = hasBefore ? areaKm2(before) : 0;
  const afterKm = hasAfter ? areaKm2(after) : 0;
  const pct = beforeKm > 0 && afterKm > 0 ? Math.round(((afterKm - beforeKm) / beforeKm) * 100) : null;

  const verdict = pct === null ? null
    : Math.abs(pct) < 3 ? 'Area is about the same size, but the shape moved'
      : pct > 0 ? `Area grew by roughly ${pct}%`
        : `Area shrank by roughly ${Math.abs(pct)}%`;

  const ink = isDark ? '#f8fafc' : '#0f172a';
  const hair = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.12)';

  return (
    <div style={{ borderRadius: 10, overflow: 'hidden', border: `1px solid ${hair}` }}>
      <div style={{ position: 'relative', height }}>
        <div ref={holder} style={{ position: 'absolute', inset: 0, background: isDark ? '#0b1220' : '#e2e8f0' }} />

        {status !== 'ready' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 7, textAlign: 'center', padding: 14,
            background: isDark ? 'rgba(11,18,32,0.92)' : 'rgba(226,232,240,0.92)',
            color: ink, fontSize: '0.68rem',
          }}>
            {status === 'loading' ? (
              <>
                <Loader2 className="animate-spin" style={{ width: 15, height: 15, opacity: 0.7 }} />
                <span style={{ opacity: 0.7 }}>Loading the area map…</span>
              </>
            ) : (
              <>
                <AlertTriangle style={{ width: 15, height: 15, color: '#f87171' }} />
                <span style={{ opacity: 0.85 }}>The area map could not be loaded.</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Legend. Stated plainly rather than relying on colour alone. */}
      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '5px 14px',
        padding: '7px 10px', borderTop: `1px solid ${hair}`,
        background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
      }}>
        {hasBefore && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.63rem', color: ink, opacity: 0.75 }}>
            <span style={{ width: 15, height: 0, borderTop: `2px dashed ${PREV_COLOUR}` }} />
            Before
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.63rem', color: ink, fontWeight: 700 }}>
          <span style={{ width: 15, height: 9, borderRadius: 2, background: `${severityHex}55`, border: `2px solid ${severityHex}` }} />
          Now
        </span>
        {verdict && (
          <span style={{ marginLeft: 'auto', fontSize: '0.62rem', color: ink, opacity: 0.6 }}>
            {verdict}
          </span>
        )}
      </div>

      {!hasBefore && (
        <p style={{
          margin: 0, padding: '7px 10px', borderTop: `1px solid ${hair}`,
          fontSize: '0.63rem', lineHeight: 1.45, color: ink, opacity: 0.6,
        }}>
          Only the current area is shown — no earlier outline was recorded for this warning.
        </p>
      )}
    </div>
  );
}
