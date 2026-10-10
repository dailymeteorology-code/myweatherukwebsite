// ArchiveMapPanel — renders the archived day's outlook map with an optional
// lightning overlay. Used in the TCMArchive detail panel. Lightweight: only
// renders what is already cached in the archive entry (no live fetches).
//
// Expected `entry` shape (best-effort — gracefully handles missing fields):
//   entry.date            "YYYY-MM-DD"
//   entry.region          "uk" | "eu"
//   entry.grid            [{ lat, lon, perDay: [{ scores: { thunderstorm, ...}}] }]
//   entry.layers          optional pre-built polygons { thunderstorm: [{level, clusters}], ... }
//   entry.strikes         [{ lat, lon, time, amp }]   ← shown when "Lightning" toggled

import React, { useMemo, useState } from 'react';
import { CloudLightning, Map as MapIcon, Zap, ZapOff } from 'lucide-react';
import TCMLeafletBase from '@/components/tcm/TCMLeafletBase';
import { smoothBlobPath } from '@/components/tcm/smoothBlobPath';
import { isInUKIreland } from '@/components/tcm/ukIrelandMask';
import { RISK_PALETTES, LEVEL_OPACITY, scoreToLevel, MIN_SCORE_PER_LEVEL } from '@/components/tcm/riskConfig';

const REGION_BBOX = {
  uk: { lonMin: -10.5, lonMax: 2.0, latMin: 49.5, latMax: 61.5 },
  eu: { lonMin: -12.0, lonMax: 32.0, latMin: 35.0, latMax: 62.0 },
};
const REGION_STEP = { uk: 0.30, eu: 0.55 };
const ORDERED_LEVELS = ['Very Low','Low','Marginal','Slight','Moderate','High','Severe'];

function clusterPoints(pts, gridStep, minSize = 4) {
  if (!pts.length) return [];
  const visited = new Set();
  const key = (p) => `${Math.round(p.lat * 1000)},${Math.round(p.lon * 1000)}`;
  const clusters = [];
  const R = gridStep * 5;
  for (const p of pts) {
    const k = key(p);
    if (visited.has(k)) continue;
    const cluster = [], queue = [p];
    visited.add(k);
    while (queue.length) {
      const cur = queue.shift();
      cluster.push(cur);
      for (const pt of pts) {
        const ck = key(pt);
        if (visited.has(ck)) continue;
        if (Math.hypot(pt.lat - cur.lat, pt.lon - cur.lon) <= R) {
          visited.add(ck); queue.push(pt);
        }
      }
    }
    if (cluster.length >= minSize) clusters.push(cluster);
  }
  return clusters;
}

function getScore(pt, riskType = 'thunderstorm') {
  return pt?.perDay?.[0]?.scores?.[riskType]
      ?? pt?.scores?.[riskType]
      ?? pt?.[riskType]
      ?? 0;
}

function buildLayers(grid, region, riskType = 'thunderstorm') {
  if (!grid?.length) return [];
  const bbox = REGION_BBOX[region] || REGION_BBOX.uk;
  const step = REGION_STEP[region] || 0.30;
  const filtered = grid.filter(p => {
    if (p.lat < bbox.latMin - 0.5 || p.lat > bbox.latMax + 0.5) return false;
    if (p.lon < bbox.lonMin - 0.5 || p.lon > bbox.lonMax + 0.5) return false;
    if (region === 'uk' && !isInUKIreland(p.lat, p.lon)) return false;
    return true;
  });
  const layers = [];
  for (const lvl of ORDERED_LEVELS) {
    const min = MIN_SCORE_PER_LEVEL[lvl] ?? 0;
    const pts = filtered.filter(p => getScore(p, riskType) >= min);
    const clusters = clusterPoints(pts, step, 4);
    if (clusters.length) layers.push({ level: lvl, clusters });
  }
  return layers;
}

const PAD_BY_LEVEL = {
  'Very Low': 3.2, 'Low': 2.8, 'Marginal': 2.2, 'Slight': 1.8,
  'Moderate': 1.4, 'High': 1.0, 'Severe': 0.7,
};

export default function ArchiveMapPanel({ entry, height = 320 }) {
  const [showLightning, setShowLightning] = useState(false);
  const [selectedStrike, setSelectedStrike] = useState(null);
  const region   = entry?.region || 'uk';
  const bbox     = REGION_BBOX[region] || REGION_BBOX.uk;
  const gridStep = REGION_STEP[region] || 0.30;

  const layers = useMemo(
    () => entry?.layers?.thunderstorm
            ?? buildLayers(entry?.grid, region, 'thunderstorm'),
    [entry, region]
  );

  const strikes = entry?.strikes || [];
  const hasStrikes = strikes.length > 0;
  const hasMap = layers.length > 0;

  return (
    <div style={{
      borderRadius: 10, overflow: 'hidden',
      background: 'rgba(0,0,0,0.3)',
      border: '1px solid rgba(56,189,248,0.3)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px',
        borderBottom: '1px solid rgba(56,189,248,0.20)',
        background: 'rgba(56,189,248,0.10)',
      }}>
        <MapIcon style={{ width: 12, height: 12, color: '#38bdf8' }} />
        <span style={{
          fontSize: '0.65rem', fontWeight: 800, color: '#38bdf8',
          letterSpacing: '0.1em', textTransform: 'uppercase',
          fontFamily: "'Space Mono', monospace",
        }}>
          Outlook Map
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowLightning(s => !s)}
          disabled={!hasStrikes}
          title={hasStrikes ? `Toggle ${strikes.length} strikes` : 'No archived strikes for this day'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '3px 9px', borderRadius: 6,
            fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.08em',
            textTransform: 'uppercase', fontFamily: "'Space Mono', monospace",
            cursor: hasStrikes ? 'pointer' : 'not-allowed',
            background: showLightning ? 'rgba(245,158,11,0.20)' : 'rgba(245,158,11,0.08)',
            border: `1px solid ${showLightning ? '#f59e0b' : 'rgba(245,158,11,0.30)'}`,
            color: '#f59e0b',
            opacity: hasStrikes ? 1 : 0.45,
          }}
        >
          {showLightning ? <Zap style={{ width: 10, height: 10 }}/> : <ZapOff style={{ width: 10, height: 10 }}/>}
          {showLightning ? 'Hide' : 'Lightning'}
          {hasStrikes && <span style={{ color: '#fbbf24' }}>· {strikes.length}</span>}
        </button>
      </div>

      <div style={{ position: 'relative' }}>
        <TCMLeafletBase bbox={bbox} height={height} lightMode={false}>
          {({ projector }) => {
            if (!projector) return null;
            const { x: w, y: h } = projector.size;
            return (
              <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}
                style={{ position: 'absolute', inset: 0, pointerEvents: showLightning ? 'all' : 'none', zIndex: 400 }}>
                <defs>
                  <pattern id="archive-severe-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(0,0,0,0.85)" strokeWidth="3" />
                  </pattern>
                </defs>

                {layers.map(layer =>
                  layer.clusters.map((cluster, ci) => {
                    const pad = PAD_BY_LEVEL[layer.level] ?? 2.0;
                    const d = smoothBlobPath(cluster, projector, gridStep, pad);
                    if (!d) return null;
                    const pal = RISK_PALETTES.thunderstorm[layer.level];
                    const isSevere = layer.level === 'Severe';
                    return (
                      <path key={`${layer.level}-${ci}`}
                        d={d}
                        fill={isSevere ? 'url(#archive-severe-hatch)' : pal.fill}
                        stroke={pal.border}
                        strokeWidth={isSevere ? 2.5 : 1.5}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        opacity={LEVEL_OPACITY[layer.level] ?? 0.7} />
                    );
                  })
                )}

                {showLightning && strikes.map((s, i) => {
                  const [x, y] = projector.project(s.lat, s.lon);
                  return (
                    <g key={`s-${i}`} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); setSelectedStrike({ strike: s, x: parseFloat(x.toFixed(1)), y: parseFloat(y.toFixed(1)) }); }}
                    >
                      <circle r={6} fill="transparent" />
                      <line x1={-3} x2={3} y1={0} y2={0} stroke="#f59e0b" strokeWidth={1.8} strokeLinecap="round" opacity={0.9}/>
                      <line y1={-3} y2={3} x1={0} x2={0} stroke="#f59e0b" strokeWidth={1.8} strokeLinecap="round" opacity={0.9}/>
                    </g>
                  );
                })}

                {!hasMap && (
                  <text x={w/2} y={h/2} textAnchor="middle" dominantBaseline="middle"
                    fontSize={11} fontFamily="'Space Mono', monospace" fill="rgba(148,163,184,0.55)">
                    No outlook geometry archived
                  </text>
                )}
              </svg>
            );
          }}
        </TCMLeafletBase>

        {showLightning && (
          <div style={{
            position: 'absolute', bottom: 8, left: 8, zIndex: 500,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 9px', borderRadius: 6,
            background: 'rgba(15,23,42,0.85)', backdropFilter: 'blur(8px)',
            border: '1px solid rgba(245,158,11,0.40)',
            fontSize: '0.6rem', fontWeight: 800, color: '#f59e0b',
            fontFamily: "'Space Mono', monospace", letterSpacing: '0.08em',
          }}>
            <CloudLightning style={{ width: 10, height: 10 }}/>
            {strikes.length} strikes · 23:59 UTC
          </div>
        )}

        {/* Strike detail popup */}
        {selectedStrike && (() => {
          const { strike: s } = selectedStrike;
          const t = new Date(s.time);
          const timeStr = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const dateStr = t.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
          const latStr = `${Math.abs(s.lat).toFixed(4)}°${s.lat >= 0 ? 'N' : 'S'}`;
          const lonStr = `${Math.abs(s.lon).toFixed(4)}°${s.lon >= 0 ? 'E' : 'W'}`;
          return (
            <div
              onClick={() => setSelectedStrike(null)}
              style={{
                position: 'absolute', inset: 0, zIndex: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
              }}
            >
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  background: '#0f172a',
                  border: '1px solid rgba(250,204,21,0.4)',
                  borderRadius: 14,
                  padding: '14px 18px',
                  minWidth: 220, maxWidth: 280,
                  boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
                  fontFamily: 'system-ui, sans-serif',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 700, color: '#facc15' }}>⚡ Archived Lightning Strike</p>
                  <button onClick={() => setSelectedStrike(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', lineHeight: 1, fontSize: '1rem', padding: '0 2px' }}>✕</button>
                </div>
                <p style={{ margin: '0 0 3px', fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>{dateStr}</p>
                <p style={{ margin: '0 0 8px', fontSize: '0.82rem', fontWeight: 800, color: '#f1f5f9', fontFamily: 'monospace' }}>{timeStr}</p>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '8px 0' }} />
                <p style={{ margin: '0 0 2px', fontSize: '0.66rem', color: '#64748b', fontFamily: 'monospace' }}>{latStr}, {lonStr}</p>
                {s.amp && <p style={{ margin: '4px 0 0', fontSize: '0.68rem', color: '#94a3b8' }}>Amplitude: <b style={{ color: '#f1f5f9' }}>{Math.abs(s.amp)} kA</b></p>}
                <p style={{ margin: '8px 0 0', fontSize: '0.62rem', color: '#475569', textAlign: 'center' }}>Tap outside to close</p>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}