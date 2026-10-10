/**
 * TCMVerification — past thunderstorm event verification page.
 * Shows archived lightning events with TCM probability outlooks
 * overlaid on actual strike data, with strike-count context.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, Zap, ZapOff, X, CloudLightning, Calendar,
  Maximize2, Info, Loader2, AlertCircle, Search, MapPin
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import TCMLeafletBase from '@/components/tcm/TCMLeafletBase';
import { smoothBlobPath } from '@/components/tcm/smoothBlobPath';
import { RISK_PALETTES, LEVEL_OPACITY, scoreToLevel, MIN_SCORE_PER_LEVEL, RISK_META, RISK_INDEX } from '@/components/tcm/riskConfig';
import { runArchiveOutlook } from '@/lib/tcmArchiveOutlook';
import { isCurrentUserAdmin } from '@/lib/tcmFetchPolicy';

// ── Region bboxes ─────────────────────────────────────────────────────────────
const UK_BBOX  = { lonMin: -10.5, lonMax: 2.5,  latMin: 49.5, latMax: 61.5 };
const EU_BBOX  = { lonMin: -12.0, lonMax: 32.0, latMin: 35.0, latMax: 62.0 };

function chooseBbox(strikes) {
  if (!strikes?.length) return EU_BBOX;
  const ukHits = strikes.filter(s =>
    s.lat >= UK_BBOX.latMin && s.lat <= UK_BBOX.latMax &&
    s.lon >= UK_BBOX.lonMin && s.lon <= UK_BBOX.lonMax
  ).length;
  return ukHits >= strikes.length * 0.3 ? UK_BBOX : EU_BBOX;
}

// ── Safe date formatter (fixes Invalid Date bug) ──────────────────────────────
function safeDate(dateStr, opts, fallback = '—') {
  if (!dateStr || typeof dateStr !== 'string') return fallback;
  // Ensure it's parsed as UTC noon to avoid timezone day-shift issues
  const d = new Date(dateStr.length === 10 ? `${dateStr}T12:00:00Z` : dateStr);
  if (isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString('en-GB', opts);
}

// ── Risk contour levels ───────────────────────────────────────────────────────
const CONTOUR_LEVELS = ['Very Low', 'Low', 'Marginal', 'Slight', 'Moderate', 'High'];

const PAD_BY_LEVEL = {
  'Very Low': 3.2, 'Low': 2.8, 'Marginal': 2.2, 'Slight': 1.8,
  'Moderate': 1.4, 'High': 1.0, 'Severe': 0.7,
};

// ── Helper: get score from a grid point ─────────────────────────────────────
function getScore(pt, riskType = 'thunderstorm', dayIdx = 0) {
  return pt?.perDay?.[dayIdx]?.scores?.[riskType]
      ?? pt?.scores?.[riskType]
      ?? pt?.[riskType]
      ?? 0;
}

// ── Cluster grid points into blobs ───────────────────────────────────────────
function clusterPoints(pts, gridStep, minSize = 4) {
  if (!pts.length) return [];
  const visited = new Set();
  const key = (p) => `${Math.round(p.lat * 1000)},${Math.round(p.lon * 1000)}`;
  const clusters = [];
  const R = gridStep * 4.5;
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

// ── Build outlook layers from a grid ─────────────────────────────────────────
function buildOutlookLayers(grid, riskType = 'thunderstorm', dayIdx = 0, bbox = EU_BBOX) {
  if (!grid?.length) return [];
  const gridStep = 0.3;
  const filtered = grid.filter(p =>
    p.lat >= bbox.latMin - 0.5 && p.lat <= bbox.latMax + 0.5 &&
    p.lon >= bbox.lonMin - 0.5 && p.lon <= bbox.lonMax + 0.5
  );
  const layers = [];
  for (const lvl of CONTOUR_LEVELS) {
    const min = MIN_SCORE_PER_LEVEL[lvl] ?? 0;
    const pts = filtered.filter(p => getScore(p, riskType, dayIdx) >= min);
    const clusters = clusterPoints(pts, gridStep, 3);
    if (clusters.length) layers.push({ level: lvl, clusters });
  }
  return layers.sort((a, b) => (RISK_INDEX[a.level] ?? 0) - (RISK_INDEX[b.level] ?? 0));
}

// ── Risk badge ────────────────────────────────────────────────────────────────
function RiskBadge({ level }) {
  if (!level || level === 'No Risk') return null;
  const pal = RISK_PALETTES.thunderstorm[level] || {};
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 99,
      fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.05em',
      background: pal.fill || 'rgba(255,255,255,0.1)',
      border: `1px solid ${pal.border || 'rgba(255,255,255,0.2)'}`,
      color: pal.border === 'transparent' ? '#94a3b8' : (pal.border || '#94a3b8'),
      flexShrink: 0,
    }}>
      {level}
    </span>
  );
}

// ── Strike density badge (NEW) ────────────────────────────────────────────────
function StrikeDensityBadge({ count, regionLabel }) {
  if (!count) return null;
  let label, color, bg;
  if (count >= 5000) { label = 'Extreme'; color = '#f87171'; bg = 'rgba(239,68,68,0.12)'; }
  else if (count >= 1000) { label = 'Severe'; color = '#fb923c'; bg = 'rgba(249,115,22,0.12)'; }
  else if (count >= 200) { label = 'High'; color = '#fbbf24'; bg = 'rgba(251,191,36,0.12)'; }
  else if (count >= 50) { label = 'Moderate'; color = '#a3e635'; bg = 'rgba(163,230,53,0.10)'; }
  else { label = 'Low'; color = '#38bdf8'; bg = 'rgba(56,189,248,0.10)'; }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '3px 8px', borderRadius: 8,
      background: bg, border: `1px solid ${color}33`,
    }}>
      <Zap style={{ width: 10, height: 10, color }} />
      <span style={{ fontSize: '0.6rem', fontWeight: 800, color, fontFamily: "'DM Mono',monospace" }}>
        {count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count} strikes
      </span>
      <span style={{ fontSize: '0.56rem', color: '#64748b' }}>· {label}</span>
      {regionLabel && <span style={{ fontSize: '0.56rem', color: '#475569' }}>· {regionLabel}</span>}
    </div>
  );
}

// ── Map legend ────────────────────────────────────────────────────────────────
function MapLegend({ layers, hasStrikes }) {
  const shownLevels = CONTOUR_LEVELS.filter(l => layers.some(lay => lay.level === l));
  if (!shownLevels.length && !hasStrikes) return null;
  return (
    <div style={{
      position: 'absolute', bottom: 8, right: 8, zIndex: 500,
      display: 'flex', flexDirection: 'column', gap: 3,
    }}>
      {shownLevels.map(lvl => {
        const pal = RISK_PALETTES.thunderstorm[lvl] || {};
        const meta = RISK_META.find(r => r.level === lvl);
        return (
          <div key={lvl} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '2px 7px', borderRadius: 5,
            background: 'rgba(10,16,34,0.88)', backdropFilter: 'blur(8px)',
            border: `1px solid ${(pal.border || '#64748b')}44`,
          }}>
            <span style={{
              width: 10, height: 10, borderRadius: 3, flexShrink: 0,
              background: pal.fill, border: `1.5px solid ${pal.border || '#64748b'}`,
            }} />
            <span style={{ fontSize: '0.58rem', fontWeight: 700, color: pal.border || '#94a3b8', fontFamily: "'DM Mono',monospace" }}>
              {lvl}
            </span>
            <span style={{ fontSize: '0.52rem', color: '#64748b', fontFamily: "'DM Mono',monospace" }}>{meta?.min}+</span>
          </div>
        );
      })}
      {hasStrikes && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '2px 7px', borderRadius: 5,
          background: 'rgba(10,16,34,0.88)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(250,204,21,0.35)',
        }}>
          <Zap style={{ width: 8, height: 8, color: '#facc15' }} />
          <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#facc15', fontFamily: "'DM Mono',monospace" }}>Strikes</span>
        </div>
      )}
    </div>
  );
}

// ── Outlook probability bar (NEW — shown in card footer) ─────────────────────
function OutlookProbabilityBar({ layers }) {
  if (!layers?.length) return null;
  // Find the highest level present
  const topLayer = layers[layers.length - 1];
  if (!topLayer) return null;
  const pal = RISK_PALETTES.thunderstorm[topLayer.level] || {};
  const totalClusters = layers.reduce((s, l) => s + l.clusters.length, 0);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: '0.56rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>Outlook:</span>
      <div style={{ display: 'flex', gap: 3 }}>
        {CONTOUR_LEVELS.map(lvl => {
          const present = layers.some(l => l.level === lvl);
          const p = RISK_PALETTES.thunderstorm[lvl] || {};
          return (
            <div key={lvl} title={lvl} style={{
              width: 12, height: 12, borderRadius: 3,
              background: present ? (p.fill || 'transparent') : 'rgba(255,255,255,0.05)',
              border: `1.5px solid ${present ? (p.border || '#64748b') : 'rgba(255,255,255,0.08)'}`,
              opacity: present ? 1 : 0.4,
              transition: 'opacity 0.15s',
            }} />
          );
        })}
      </div>
      <span style={{ fontSize: '0.58rem', fontWeight: 800, color: pal.border || '#64748b', fontFamily: "'DM Mono',monospace" }}>
        Peak: {topLayer.level}
      </span>
      {totalClusters > 1 && (
        <span style={{ fontSize: '0.55rem', color: '#475569' }}>· {totalClusters} zones</span>
      )}
    </div>
  );
}

// ── Verification map component ────────────────────────────────────────────────
function VerificationMap({ grid, strikes, showLightning, height = 280, lightMode = false, bbox: bboxProp, interactive = false }) {
  const bbox = bboxProp || (strikes?.length ? chooseBbox(strikes) : EU_BBOX);
  const layers = useMemo(() => buildOutlookLayers(grid || [], 'thunderstorm', 0, bbox), [grid, bbox]);
  const hasStrikes = strikes?.length > 0;

  return (
    <div style={{ position: 'relative' }}>
      <TCMLeafletBase
        bbox={bbox}
        height={height}
        lightMode={lightMode}
        showStyleSwitcher={interactive}
        showOpacitySlider={interactive}
      >
        {({ projector }) => {
          if (!projector) return null;
          const { x: w, y: h } = projector.size;
          return (
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 400 }}>
              <defs>
                <filter id="ver-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" />
                </filter>
                <pattern id="ver-severe-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(0,0,0,0.85)" strokeWidth="3" />
                </pattern>
              </defs>

              {/* Glow pass */}
              {layers.map(layer =>
                layer.clusters.map((cluster, ci) => {
                  const pad = PAD_BY_LEVEL[layer.level] ?? 2;
                  const d = smoothBlobPath(cluster, projector, 0.3, pad);
                  if (!d) return null;
                  const pal = RISK_PALETTES.thunderstorm[layer.level] || {};
                  return (
                    <path key={`glow-${layer.level}-${ci}`}
                      d={d} fill={pal.border} stroke="none"
                      opacity={0.15} filter="url(#ver-glow)" pointerEvents="none" />
                  );
                })
              )}

              {/* Fill pass */}
              {layers.map(layer =>
                layer.clusters.map((cluster, ci) => {
                  const pad = PAD_BY_LEVEL[layer.level] ?? 2;
                  const d = smoothBlobPath(cluster, projector, 0.3, pad);
                  if (!d) return null;
                  const pal = RISK_PALETTES.thunderstorm[layer.level] || {};
                  const isSevere = layer.level === 'Severe';
                  return (
                    <path key={`fill-${layer.level}-${ci}`}
                      d={d}
                      fill={isSevere ? 'url(#ver-severe-hatch)' : pal.fill}
                      stroke={pal.border}
                      strokeWidth={isSevere ? 2.2 : 1.6}
                      strokeLinejoin="round" strokeLinecap="round"
                      opacity={LEVEL_OPACITY[layer.level] ?? 0.7}
                      pointerEvents="none" />
                  );
                })
              )}

              {/* Risk level labels for Moderate+ */}
              {layers.filter(l => (RISK_INDEX[l.level] ?? 0) >= (RISK_INDEX['Moderate'] ?? 0)).map(layer =>
                layer.clusters.map((cluster, ci) => {
                  if (cluster.length < 3) return null;
                  const projected = cluster.map(p => projector.project(p.lat, p.lon));
                  const cx = projected.reduce((s, p) => s + p[0], 0) / projected.length;
                  const cy = projected.reduce((s, p) => s + p[1], 0) / projected.length;
                  const lbl = RISK_META.find(r => r.level === layer.level)?.short;
                  if (!lbl) return null;
                  return (
                    <g key={`lbl-${layer.level}-${ci}`}>
                      <text x={cx + 0.7} y={cy + 1.5} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={900} fontFamily="DM Mono,monospace" fill="rgba(0,0,0,0.65)" letterSpacing="0.1em">{lbl}</text>
                      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={900} fontFamily="DM Mono,monospace" fill="rgba(255,255,255,0.96)" letterSpacing="0.1em">{lbl}</text>
                    </g>
                  );
                })
              )}

              {/* Lightning strikes */}
              {showLightning && hasStrikes && (strikes || []).map((s, i) => {
                const [x, y] = projector.project(s.lat, s.lon);
                if (x < -5 || y < -5 || x > w + 5 || y > h + 5) return null;
                const isIntense = s.amp && Math.abs(s.amp) > 50;
                return (
                  <g key={`strike-${i}`} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`} pointerEvents="none">
                    <circle r={isIntense ? 3.5 : 2.2} fill={isIntense ? '#ffffff' : '#facc15'} opacity={0.9} />
                    {isIntense && <circle r={5.5} fill="none" stroke="#ffffff" strokeWidth={0.8} opacity={0.3} />}
                  </g>
                );
              })}

              {/* Empty state */}
              {layers.length === 0 && !showLightning && (
                <text x={w / 2} y={h / 2} textAnchor="middle" dominantBaseline="middle"
                  fontSize={12} fontFamily="DM Sans,system-ui" fill="rgba(148,163,184,0.5)">
                  No outlook data archived for this day
                </text>
              )}
            </svg>
          );
        }}
      </TCMLeafletBase>
      <MapLegend layers={layers} hasStrikes={hasStrikes && showLightning} />
    </div>
  );
}

// ── Full-screen event modal ───────────────────────────────────────────────────
function EventFullscreenModal({ event, onClose }) {
  const [showLightning, setShowLightning] = useState(true);
  const grid = event?.grid_data || [];
  const strikes = event?.strikes || [];
  const hasStrikes = (event?.total_count ?? strikes.length) > 0;
  const eventBbox = event?.bbox || (strikes.length ? chooseBbox(strikes) : EU_BBOX);

  const layers = useMemo(() => buildOutlookLayers(grid, 'thunderstorm', 0, eventBbox), [grid, eventBbox]);

  const peakLevel = useMemo(() => {
    if (!grid.length) return null;
    let best = 0;
    for (const pt of grid) { const s = getScore(pt); if (s > best) best = s; }
    return scoreToLevel(best);
  }, [grid]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dateLabel = safeDate(event.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Compute strike region breakdown
  const ukStrikes = useMemo(() => strikes.filter(s =>
    s.lat >= UK_BBOX.latMin && s.lat <= UK_BBOX.latMax &&
    s.lon >= UK_BBOX.lonMin && s.lon <= UK_BBOX.lonMax
  ).length, [strikes]);
  const euStrikes = strikes.length - ukStrikes;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="ver-fullscreen"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(6,11,24,0.97)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid rgba(56,189,248,0.15)',
          background: 'rgba(10,16,34,0.95)',
          backdropFilter: 'blur(12px)',
          flexShrink: 0, flexWrap: 'wrap',
        }}>
          <button onClick={onClose} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 13px', borderRadius: 9, cursor: 'pointer',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            color: '#94a3b8', fontSize: '0.78rem', fontWeight: 700,
          }}>
            <ChevronLeft style={{ width: 14, height: 14 }} /> Back
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '1rem', fontWeight: 900, color: '#f1f5f9', lineHeight: 1.2 }}>
              {event.title || event.date || 'Event'}
            </div>
            <div style={{ fontSize: '0.68rem', color: '#64748b', fontFamily: "'DM Mono',monospace", marginTop: 2 }}>
              {dateLabel}
              {hasStrikes && ` · ${(event.total_count || strikes.length).toLocaleString()} strikes`}
            </div>
          </div>

          {/* Outlook info strip */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
            {peakLevel && <RiskBadge level={peakLevel} />}
            {layers.length > 0 && (
              <div style={{ display: 'flex', gap: 2 }}>
                {CONTOUR_LEVELS.map(lvl => {
                  const present = layers.some(l => l.level === lvl);
                  const p = RISK_PALETTES.thunderstorm[lvl] || {};
                  return (
                    <div key={lvl} title={lvl} style={{
                      width: 10, height: 10, borderRadius: 2,
                      background: present ? (p.fill || 'transparent') : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${present ? (p.border || '#64748b') : 'rgba(255,255,255,0.08)'}`,
                      opacity: present ? 1 : 0.3,
                    }} />
                  );
                })}
              </div>
            )}
          </div>

          {/* Strike breakdown */}
          {strikes.length > 0 && (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end',
              padding: '4px 10px', borderRadius: 8,
              background: 'rgba(250,204,21,0.06)',
              border: '1px solid rgba(250,204,21,0.15)',
            }}>
              <div style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Strike split</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ fontSize: '0.66rem', color: '#facc15', fontWeight: 800, fontFamily: "'DM Mono',monospace" }}>
                  <MapPin style={{ width: 8, height: 8, display: 'inline', marginRight: 2 }} />
                  UK: {ukStrikes.toLocaleString()}
                </span>
                {euStrikes > 0 && (
                  <span style={{ fontSize: '0.66rem', color: '#fbbf24', fontWeight: 700, fontFamily: "'DM Mono',monospace", opacity: 0.75 }}>
                    EU: {euStrikes.toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Lightning toggle */}
          <button onClick={() => setShowLightning(s => !s)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 13px', borderRadius: 9, cursor: 'pointer',
            background: showLightning ? 'rgba(250,204,21,0.15)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${showLightning ? '#facc15' : 'rgba(255,255,255,0.10)'}`,
            color: '#facc15', fontSize: '0.78rem', fontWeight: 700,
          }}>
            {showLightning ? <Zap style={{ width: 13, height: 13 }} /> : <ZapOff style={{ width: 13, height: 13 }} />}
            <span style={{ display: 'none' }}>{showLightning ? 'Hide' : 'Show'}</span>
            {hasStrikes && <span style={{ fontSize: '0.66rem', opacity: 0.8 }}>· {(event.total_count || strikes.length).toLocaleString()}</span>}
          </button>

          <button onClick={onClose} style={{
            width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)', color: '#64748b',
          }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Map — interactive so scroll wheel works */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <VerificationMap
            grid={grid}
            strikes={strikes}
            showLightning={showLightning}
            height={typeof window !== 'undefined' ? window.innerHeight - 80 : 600}
            lightMode={false}
            bbox={eventBbox}
            interactive={true}
          />
        </div>

        {event.description && (
          <div style={{
            padding: '10px 18px',
            borderTop: '1px solid rgba(56,189,248,0.12)',
            background: 'rgba(10,16,34,0.90)',
            fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.5, flexShrink: 0,
          }}>
            {event.description}
          </div>
        )}
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

// ── Skeleton card (loading state) ─────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div style={{
      borderRadius: 14, overflow: 'hidden',
      background: 'rgba(10,16,34,0.92)',
      border: '1px solid rgba(56,189,248,0.08)',
    }}>
      <div style={{
        height: 180, background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(56,189,248,0.06) 50%, rgba(255,255,255,0.03) 100%)',
        backgroundSize: '200% 100%',
        animation: 'ver-shimmer 1.6s ease-in-out infinite',
      }} />
      <div style={{ padding: '10px 13px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ height: 10, borderRadius: 5, width: '70%', background: 'rgba(255,255,255,0.06)', animation: 'ver-shimmer 1.6s ease-in-out infinite 0.1s' }} />
        <div style={{ height: 8, borderRadius: 5, width: '45%', background: 'rgba(255,255,255,0.04)', animation: 'ver-shimmer 1.6s ease-in-out infinite 0.2s' }} />
        <div style={{ height: 8, borderRadius: 5, width: '55%', background: 'rgba(255,255,255,0.04)', animation: 'ver-shimmer 1.6s ease-in-out infinite 0.3s' }} />
      </div>
    </div>
  );
}

// ── Event card ────────────────────────────────────────────────────────────────
function EventCard({ event, onClick }) {
  const grid = event?.grid_data || [];
  const strikes = event?.strikes || [];
  const hasStrikes = event.total_count > 0;
  const hasGrid = grid.length > 0;
  const [hovered, setHovered] = useState(false);
  const eventBbox = event.bbox || EU_BBOX;

  const peakLevel = useMemo(() => {
    if (!grid.length) return null;
    let best = 0;
    for (const pt of grid) { const s = getScore(pt); if (s > best) best = s; }
    return scoreToLevel(best);
  }, [grid]);

  const layers = useMemo(() => buildOutlookLayers(grid, 'thunderstorm', 0, eventBbox), [grid, eventBbox]);

  const dateShort = safeDate(event.date, { day: 'numeric', month: 'short', year: 'numeric' });
  const weekday = safeDate(event.date, { weekday: 'long' });

  // Compute region for strike breakdown
  const ukStrikes = useMemo(() => strikes.filter(s =>
    s.lat >= UK_BBOX.latMin && s.lat <= UK_BBOX.latMax &&
    s.lon >= UK_BBOX.lonMin && s.lon <= UK_BBOX.lonMax
  ).length, [strikes]);

  const regionLabel = event.uk_count >= 5 ? 'UK' : (event.eu_count > 0 ? 'EU' : null);

  return (
    <motion.div
      whileHover={{ scale: 1.012 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      onClick={onClick}
      style={{
        borderRadius: 14, overflow: 'hidden', cursor: 'pointer',
        background: 'rgba(10,16,34,0.92)',
        border: `1px solid ${hovered ? 'rgba(56,189,248,0.4)' : 'rgba(56,189,248,0.15)'}`,
        boxShadow: hovered
          ? '0 8px 32px rgba(56,189,248,0.12), 0 2px 8px rgba(0,0,0,0.4)'
          : '0 2px 8px rgba(0,0,0,0.3)',
        transition: 'border-color 0.18s, box-shadow 0.18s',
        position: 'relative',
      }}
    >
      {/* Top aurora rail */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(56,189,248,0.5), transparent)',
        zIndex: 2,
      }} />

      {/* Map preview — pointer-events none to keep scroll passthrough on card grid */}
      <div style={{ position: 'relative', pointerEvents: 'none' }}>
        <VerificationMap
          grid={grid}
          strikes={strikes}
          showLightning={true}
          height={190}
          lightMode={false}
          bbox={eventBbox}
          interactive={false}
        />
        {/* Expand hint */}
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 10,
          background: 'rgba(6,11,24,0.75)', borderRadius: 7,
          padding: '4px 8px', border: '1px solid rgba(56,189,248,0.3)',
          display: 'flex', alignItems: 'center', gap: 4,
          opacity: hovered ? 1 : 0.6, transition: 'opacity 0.15s',
        }}>
          <Maximize2 style={{ width: 10, height: 10, color: '#38bdf8' }} />
          <span style={{ fontSize: '0.55rem', color: '#38bdf8', fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>EXPAND</span>
        </div>
      </div>

      {/* Card footer */}
      <div style={{ padding: '10px 13px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#f1f5f9', lineHeight: 1.3 }}>
              {event.title || `Thunderstorm Event — ${dateShort}`}
            </div>
            <div style={{ fontSize: '0.6rem', color: '#64748b', fontFamily: "'DM Mono',monospace", marginTop: 1 }}>
              {weekday !== '—' ? `${weekday}, ` : ''}{dateShort}
            </div>
          </div>
          {peakLevel && <RiskBadge level={peakLevel} />}
        </div>

        {/* Strike density badge */}
        {hasStrikes && (
          <StrikeDensityBadge count={event.total_count} regionLabel={regionLabel} />
        )}

        {/* Outlook probability bar */}
        {hasGrid && <OutlookProbabilityBar layers={layers} />}

        {/* No grid warning */}
        {!hasGrid && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Info style={{ width: 10, height: 10, color: '#475569' }} />
            <span style={{ fontSize: '0.58rem', color: '#475569' }}>No outlook grid archived for this day</span>
          </div>
        )}

        {/* Peak hour */}
        {event.peak_hour && (
          <div style={{ fontSize: '0.58rem', color: '#475569' }}>
            Peak activity: <span style={{ color: '#64748b', fontWeight: 700 }}>{event.peak_hour} UTC</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Derive events from LightningArchive ───────────────────────────────────────
function buildEventsFromArchive(archives) {
  return archives
    .filter(a => {
      const total = Math.max(
        a.uk_count ?? 0, a.eu_count ?? 0,
        a.strike_count ?? 0, a.strikes?.length ?? 0
      );
      return total >= 3 && a.date; // guard against missing date
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .map(a => {
      const totalCount = Math.max(
        a.uk_count ?? 0, a.eu_count ?? 0,
        a.strike_count ?? 0, a.strikes?.length ?? 0
      );
      const ukCount = a.uk_count ?? 0;
      const region = ukCount >= 5 ? 'UK' : 'Europe';
      const dateLabel = safeDate(a.date, { day: 'numeric', month: 'long', year: 'numeric' });
      return {
        id: a.id,
        date: a.date,
        title: `${region} Thunderstorm — ${dateLabel}`,
        description: a.peak_hour ? `Peak at ${a.peak_hour} UTC` : undefined,
        strikes: a.strikes || [],
        grid_data: a.grid_data || [],
        uk_count: ukCount,
        eu_count: a.eu_count ?? 0,
        total_count: totalCount,
        peak_hour: a.peak_hour,
        bbox: ukCount >= 5 ? UK_BBOX : EU_BBOX,
      };
    });
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TCMVerification() {
  const [archives, setArchives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [search, setSearch] = useState('');
  const [minStrikes, setMinStrikes] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [runState, setRunState] = useState(null);

  useEffect(() => { isCurrentUserAdmin().then(setIsAdmin).catch(() => {}); }, []);

  useEffect(() => {
    base44.entities.LightningArchive.list('-date', 200)
      .then(data => { setArchives(data); setLoading(false); })
      .catch(err => {
        console.error('[TCMVerification] failed:', err);
        setError('Could not load lightning archive data.');
        setLoading(false);
      });
  }, []);

  const events = useMemo(() => buildEventsFromArchive(archives), [archives]);

  // Admin: run the TCM engine on historical (ERA5) weather for every archived
  // event that has no outlook yet, and save the grid so it overlays the strikes.
  const runBackfill = async () => {
    setRunState({ running: true, i: 0, n: 0, date: 'loading events…', done: 0, total: 0 });
    // Use the already-loaded events; if the heavy archive list hasn't populated
    // them (huge strike arrays can stall it), load a fresh copy right here.
    let evs = events;
    if (!evs.length) {
      try { evs = buildEventsFromArchive(await base44.entities.LightningArchive.list('-date', 200)); }
      catch (e) { setRunState({ error: 'Could not load archived events: ' + String(e?.message || e) }); return; }
    }
    const targets = evs.filter((e) => !(e.grid_data && e.grid_data.length));
    if (!targets.length) {
      setRunState({ msg: evs.length ? 'All archived events already have an outlook.' : 'No archived lightning events found to run on.' });
      return;
    }
    const ctrl = new AbortController();
    setRunState({ running: true, ctrl, i: 0, n: targets.length, date: '', done: 0, total: 0 });
    try {
      for (let i = 0; i < targets.length; i++) {
        const ev = targets[i];
        const grid_data = await runArchiveOutlook(ev, {
          signal: ctrl.signal,
          onProgress: ({ done, total }) => setRunState((s) => ({ ...(s || {}), running: true, ctrl, i, n: targets.length, date: ev.date, done, total })),
        });
        const built = Date.now();
        await base44.entities.LightningArchive.update(ev.id, { grid_data, outlook_built_at: built, outlook_source: 'era5-archive' });
        setArchives((prev) => prev.map((a) => (a.id === ev.id ? { ...a, grid_data, outlook_built_at: built, outlook_source: 'era5-archive' } : a)));
      }
      setRunState({ msg: `Done — generated ${targets.length} outlook${targets.length > 1 ? 's' : ''} from the ERA5 archive.` });
    } catch (e) {
      setRunState({ error: String(e?.message || e) });
    }
  };

  const filtered = useMemo(() => {
    let out = events;
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(e =>
        (e.date || '').includes(q) ||
        (e.title || '').toLowerCase().includes(q)
      );
    }
    if (minStrikes > 0) out = out.filter(e => e.total_count >= minStrikes);
    return out;
  }, [events, search, minStrikes]);

  const totalStrikes = useMemo(() => events.reduce((s, e) => s + (e.total_count || 0), 0), [events]);
  const biggestEvent = useMemo(() => {
    if (!events.length) return null;
    return events.reduce((best, e) => (e.total_count > (best?.total_count ?? 0) ? e : best), null);
  }, [events]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #060b18 0%, #0b1226 50%, #0a1020 100%)',
      fontFamily: "'DM Sans', system-ui, sans-serif",
      paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 0', maxWidth: 1200, margin: '0 auto' }}>
        <Link to="/TCMOutlooks" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          textDecoration: 'none', color: '#64748b', fontSize: '0.76rem', fontWeight: 700,
          padding: '6px 12px', borderRadius: 8, marginBottom: 16,
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <ChevronLeft style={{ width: 13, height: 13 }} /> TCM Outlooks
        </Link>

        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(56,189,248,0.18), rgba(129,140,248,0.12))',
              border: '1px solid rgba(56,189,248,0.28)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 20px rgba(56,189,248,0.12)',
            }}>
              <CloudLightning style={{ width: 20, height: 20, color: '#38bdf8' }} />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 900, color: '#f1f5f9', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                TCM Verification
              </h1>
              <p style={{ margin: '3px 0 0', fontSize: '0.76rem', color: '#64748b', lineHeight: 1.3 }}>
                Past thunderstorm events — probability outlook vs actual strikes
              </p>
            </div>
          </div>

          {/* Admin: run the model on archived events to generate the outlook overlay */}
          {isAdmin && (() => {
            const missing = events.filter((e) => !(e.grid_data && e.grid_data.length)).length;
            const rs = runState;
            return (
              <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#c4b5fd' }}>Admin · Run model on archive</span>
                  <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{missing} event{missing !== 1 ? 's' : ''} without an outlook</span>
                  <div style={{ flex: 1 }} />
                  {rs?.running ? (
                    <button onClick={() => rs.ctrl?.abort()} style={{ padding: '7px 13px', borderRadius: 9, background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.45)', color: '#f87171', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
                  ) : (
                    <button onClick={runBackfill} style={{ padding: '7px 13px', borderRadius: 9, background: 'rgba(167,139,250,0.16)', border: '1px solid rgba(167,139,250,0.5)', color: '#c4b5fd', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer' }}>
                      Generate outlooks
                    </button>
                  )}
                </div>
                {rs?.running && (
                  <div style={{ marginTop: 9 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.64rem', color: '#94a3b8', marginBottom: 4 }}>
                      <span>Event {(rs.i ?? 0) + 1}/{rs.n} · {rs.date}</span>
                      <span>{rs.done}/{rs.total} cells</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${rs.total ? Math.round((rs.done / rs.total) * 100) : 0}%`, background: 'linear-gradient(90deg,#38bdf8,#a78bfa)', borderRadius: 99, transition: 'width .2s' }} />
                    </div>
                  </div>
                )}
                {rs?.msg && <div style={{ marginTop: 8, fontSize: '0.68rem', color: '#86efac' }}>{rs.msg}</div>}
                {rs?.error && <div style={{ marginTop: 8, fontSize: '0.68rem', color: '#fca5a5' }}>{rs.error}</div>}
              </div>
            );
          })()}
          {/* Stats strip */}
          {!loading && events.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
              {[
                { label: 'Events archived', value: events.length },
                { label: 'Total strikes', value: totalStrikes.toLocaleString() },
                { label: 'Busiest event', value: biggestEvent ? `${(biggestEvent.total_count || 0).toLocaleString()}` : '—' },
              ].map(stat => (
                <div key={stat.label} style={{
                  padding: '8px 14px', borderRadius: 10,
                  background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.14)',
                }}>
                  <div style={{ fontSize: '0.58rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{stat.label}</div>
                  <div style={{ fontSize: '1rem', fontWeight: 900, color: '#38bdf8', fontFamily: "'DM Mono',monospace", marginTop: 2 }}>{stat.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Filters */}
        {!loading && events.length > 0 && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 160 }}>
              <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: '#64748b', pointerEvents: 'none' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search events, dates…"
                style={{
                  width: '100%', padding: '9px 12px 9px 32px', borderRadius: 9,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
                  color: '#e2e8f0', fontSize: '0.8rem', outline: 'none',
                  fontFamily: "'DM Sans',system-ui", boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 700, whiteSpace: 'nowrap' }}>Min strikes:</span>
              {[0, 50, 200, 500, 1000].map(n => (
                <button key={n} onClick={() => setMinStrikes(n)} style={{
                  padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: '0.7rem', fontWeight: 800,
                  background: minStrikes === n ? 'rgba(250,204,21,0.18)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${minStrikes === n ? '#facc15' : 'rgba(255,255,255,0.10)'}`,
                  color: minStrikes === n ? '#facc15' : '#64748b',
                }}>
                  {n === 0 ? 'All' : `${n >= 1000 ? n / 1000 + 'k' : n}+`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 16px' }}>

        {/* Skeleton loading grid */}
        {loading && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))',
            gap: 16,
          }}>
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {!loading && error && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '60px 0', color: '#f87171' }}>
            <AlertCircle style={{ width: 28, height: 28 }} />
            <p style={{ margin: 0, fontSize: '0.85rem' }}>{error}</p>
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '60px 20px', textAlign: 'center' }}>
            <CloudLightning style={{ width: 36, height: 36, color: '#334155' }} />
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', margin: 0, fontWeight: 700 }}>No archived thunderstorm events yet</p>
            <p style={{ color: '#64748b', fontSize: '0.76rem', margin: 0, lineHeight: 1.5, maxWidth: 380 }}>
              Events appear here once lightning data is archived. Days with 3+ strikes are shown automatically.
            </p>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && events.length > 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b', fontSize: '0.82rem' }}>
            No events match your current filter.
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <>
            <div style={{ marginBottom: 10, fontSize: '0.68rem', color: '#64748b' }}>
              Showing {filtered.length} of {events.length} events · click any card to expand
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))',
              gap: 16,
            }}>
              {filtered.map(event => (
                <EventCard
                  key={event.id || event.date}
                  event={event}
                  onClick={() => setSelectedEvent(event)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Full-screen modal */}
      <AnimatePresence>
        {selectedEvent && (
          <EventFullscreenModal
            event={selectedEvent}
            onClose={() => setSelectedEvent(null)}
          />
        )}
      </AnimatePresence>

      <style>{`
        @keyframes ver-shimmer {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }
      `}</style>
    </div>
  );
}