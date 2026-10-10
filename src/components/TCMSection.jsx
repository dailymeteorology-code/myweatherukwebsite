import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, isValid } from 'date-fns';
import {
  ChevronDown, ChevronUp, Calendar, Clock, MapPin,
  AlertTriangle, Archive, X, ZoomIn, Zap, Wind,
  Droplets, CloudLightning, Tornado, ChevronLeft, ChevronRight,
  Play, Pause, Eye, EyeOff, Download
} from 'lucide-react';
import { downloadOutlookAsImage, exportOutlookAsPDF } from '@/lib/exportGraphicPDF';

// ── Risk colour palette ─────────────────────────────────────────────────────
const RISK_COLORS = {
  'No Risk':  { fill: '#94a3b8', stroke: '#64748b', badge: 'rgba(100,116,139,0.15)', text: '#94a3b8' },
  'Very Low': { fill: '#86efac', stroke: '#15803d', badge: 'rgba(134,239,172,0.15)', text: '#4ade80' },
  'Low':      { fill: '#4ade80', stroke: '#166534', badge: 'rgba(74,222,128,0.15)',  text: '#22c55e' },
  'Marginal': { fill: '#fde047', stroke: '#a16207', badge: 'rgba(253,224,71,0.15)',  text: '#eab308' },
  'Moderate': { fill: '#fb923c', stroke: '#c2410c', badge: 'rgba(251,146,60,0.15)',  text: '#f97316' },
  'High':     { fill: '#f87171', stroke: '#b91c1c', badge: 'rgba(248,113,113,0.15)', text: '#ef4444' },
  'Severe':   { fill: '#1e1e1e', stroke: '#ffffff', badge: 'rgba(255,255,255,0.10)', text: '#f8fafc' },
};

function riskLabel(levels, level) {
  const order = ['No Risk', 'Very Low', 'Low', 'Marginal', 'Moderate', 'High', 'Severe'];
  const src = levels?.length > 0 ? levels : level ? [level] : [];
  if (!src.length) return null;
  if (src.length === 1) {
    if (src[0] === 'No Risk') return 'No Risk';
    return src[0] + ' Risk';
  }
  const sorted = [...src].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return `${sorted[0]} – ${sorted[sorted.length - 1]} Risk`;
}

// ── Leaflet singleton loader ────────────────────────────────────────────────
let _lfPromise = null;
function loadLeaflet() {
  if (_lfPromise) return _lfPromise;
  _lfPromise = new Promise(resolve => {
    if (window.L) { resolve(); return; }
    if (!document.querySelector('#leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css'; link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = resolve;
    document.head.appendChild(s);
  });
  return _lfPromise;
}

// ── Risk Map ─────────────────────────────────────────────────────────────────
// Renders admin-drawn risk areas on a Leaflet map.
// • Map is created once and reused — areas are redrawn as a separate effect
//   so the tile layer never flickers.
// • fitBounds is deferred by one frame so the container is fully sized
//   before Leaflet measures it (avoids the "map stuck at 0,0" bug when
//   rendered inside an AnimatePresence height:auto transition).
// • Points are stored as [lat, lng] pairs by TCMAdmin — that's what
//   Leaflet expects, so no coordinate swapping is needed.
function RiskMap({ areas, compact = false }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const layersRef    = useRef([]);
  const [ready, setReady] = useState(false);

  // Load Leaflet once
  useEffect(() => { loadLeaflet().then(() => setReady(true)); }, []);

  // Create the map once when Leaflet is ready
  useEffect(() => {
    if (!ready || !containerRef.current || mapRef.current) return;
    const L = window.L;
    const map = L.map(containerRef.current, {
      center: [54.5, -2.5],
      zoom: compact ? 5 : 6,
      zoomControl: !compact,
      scrollWheelZoom: false,
      dragging: !compact,
      doubleClickZoom: false,
      preferCanvas: true,
    });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© OpenStreetMap © Esri',
      maxZoom: 19,
      tileSize: 256,
      detectRetina: true,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      try { map.remove(); } catch (_) {}
      mapRef.current = null;
    };
  }, [ready, compact]); // eslint-disable-line

  // Redraw areas whenever the areas array or the map changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const L = window.L;

    // Remove old area layers
    layersRef.current.forEach(l => { try { map.removeLayer(l); } catch (_) {} });
    layersRef.current = [];

    const validAreas = (areas || []).filter(a => Array.isArray(a.points) && a.points.length >= 3);
    if (!validAreas.length) return;

    // Draw each area using the exact [lat, lng] points stored by the admin tool
    validAreas.forEach(area => {
      const colors = RISK_COLORS[area.risk_level] || { fill: '#94a3b8', stroke: '#475569' };
      const layer = L.polygon(area.points, {
        color:       colors.stroke,
        weight:      compact ? 2 : 2.5,
        fillColor:   colors.fill,
        fillOpacity: 0.45,
        dashArray:   null,
      }).addTo(map);
      layer.bindTooltip(`${area.risk_level} Risk`, { permanent: false, sticky: true });
      layersRef.current.push(layer);
    });

    // Defer fitBounds by one animation frame so the container is fully laid
    // out (especially important when inside a height:auto Framer Motion
    // transition — measuring too early gives a 0-height container and
    // Leaflet centres on [0,0]).
    requestAnimationFrame(() => {
      try {
        const group = L.featureGroup(layersRef.current);
        const bounds = group.getBounds();
        if (bounds.isValid()) {
          map.invalidateSize();
          map.fitBounds(bounds.pad(0.18));
        }
      } catch (_) {}
    });
  }, [ready, areas, compact]); // eslint-disable-line

  return (
    <div
      ref={containerRef}
      style={{
        height: compact ? 210 : 340,
        width: '100%',
        borderRadius: compact ? 10 : 14,
        overflow: 'hidden',
        background: '#0f172a',
      }}
    />
  );
}

// ── Thunderstorm Risk Panel ─────────────────────────────────────────────────
const PERCENT_RISKS = [
  { key: 'tornado_risk',      label: 'Tornadoes',      color: '#ef4444', track: 'rgba(239,68,68,0.15)' },
  { key: 'hail_risk',         label: 'Hail',           color: '#0ea5e9', track: 'rgba(14,165,233,0.15)' },
  { key: 'flash_flood_risk',  label: 'Flash flooding', color: '#3b82f6', track: 'rgba(59,130,246,0.15)' },
  { key: 'strong_winds_risk', label: 'Strong winds',   color: '#14b8a6', track: 'rgba(20,184,166,0.15)' },
  { key: 'supercell_risk',    label: 'Supercells',     color: '#a855f7', track: 'rgba(168,85,247,0.15)' },
];

const BOOL_RISKS = [
  { key: 'high_lightning', label: '⚡ High lightning', style: { background: 'rgba(250,204,21,0.15)', color: '#facc15', border: '1px solid rgba(250,204,21,0.3)' } },
  { key: 'heavy_rain',     label: '🌧 Heavy rain',     style: { background: 'rgba(59,130,246,0.15)',  color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)'  } },
];

// Severe thunderstorm risk — rendered separately as it is independent of the overall risk band.
// A "Low Risk" outlook CAN carry a severe thunderstorm risk flag, meaning that although
// the overall probability of storms is low, ANY storm that does develop may be severe.
const SEVERE_RISK_STYLE = { background: 'rgba(239,68,68,0.18)', color: '#f87171', border: '1px solid rgba(239,68,68,0.5)', fontWeight: 800 };

function ThunderstormRiskPanel({ risks = {}, compact = false }) {
  const activePercents = PERCENT_RISKS.filter(r => (risks[r.key] ?? 0) > 0);
  const activeBools    = BOOL_RISKS.filter(r => !!risks[r.key]);
  const isSevere       = !!risks.severe;
  const hasMetrics     = !!(risks.wind_speed_mph || risks.rain_mm_per_hour || 
                            risks.hail_diameter_mm || risks.tornado_intensity);

  if (!activePercents.length && !activeBools.length && !hasMetrics && !isSevere) return null;

  return (
    <div
      style={{
        background: 'rgba(10,10,28,0.65)',
        border: '1px solid rgba(139,92,246,0.22)',
        borderRadius: 14,
        padding: compact ? '10px 12px' : '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        flexShrink: 0,
        width: compact ? 164 : '100%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Zap style={{ width: 12, height: 12, color: 'rgba(139,92,246,0.8)', flexShrink: 0 }} />
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(139,92,246,0.75)' }}>
          Risk details
        </span>
      </div>

      {/* Severe thunderstorm risk — always shown first and prominently, independent of overall risk band */}
      {isSevere && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 8, ...SEVERE_RISK_STYLE }}>
          <AlertTriangle style={{ width: 11, height: 11, flexShrink: 0 }} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.03em' }}>
            Risk of severe thunderstorms
          </span>
        </div>
      )}

      {activePercents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {activePercents.map(({ key, label, color, track }) => {
            const val = risks[key];
            return (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color }}>{label}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color }}>{val}%</span>
                </div>
                <div style={{ height: 4, borderRadius: 999, background: track, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${val}%`, borderRadius: 999, background: color }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activePercents.length > 0 && (activeBools.length > 0 || hasMetrics) && (
        <div style={{ height: 1, background: 'rgba(148,163,184,0.1)' }} />
      )}

      {activeBools.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {activeBools.map(({ key, label, style }) => (
            <span key={key} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, ...style }}>
              {label}
            </span>
          ))}
        </div>
      )}

      {activeBools.length > 0 && hasMetrics && (
        <div style={{ height: 1, background: 'rgba(148,163,184,0.1)' }} />
      )}

      {hasMetrics && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {risks.wind_speed_mph && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#475569' }}>Wind speed</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>{risks.wind_speed_mph} mph</span>
            </div>
          )}
          {risks.rain_mm_per_hour && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#475569' }}>Rainfall</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>{risks.rain_mm_per_hour} mm/hr</span>
            </div>
          )}
          {risks.hail_diameter_mm && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#475569' }}>Hail size</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>{risks.hail_diameter_mm} mm</span>
            </div>
          )}
          {risks.tornado_intensity && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#475569' }}>Tornado</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#f87171' }}>{risks.tornado_intensity}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Archive detail modal ────────────────────────────────────────────────────
function ArchiveModal({ outlook, onClose }) {
  const label = riskLabel(outlook.risk_levels, outlook.risk_level);
  const colors = RISK_COLORS[outlook.risk_level] || RISK_COLORS['Marginal'];
  const hasMap = outlook.risk_areas?.length > 0;
  const hasThunderstormRisks = outlook.thunderstorm_risks && Object.keys(outlook.thunderstorm_risks).length > 0;
  const isSevere = !!outlook.thunderstorm_risks?.severe;

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 24 }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl"
        style={{
          background: 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)',
          border: '1px solid rgba(148,163,184,0.1)',
          boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(148,163,184,0.15) transparent',
        }}
      >
        <div style={{ height: 3, background: `linear-gradient(90deg, ${colors.stroke}, ${colors.fill} 60%, transparent)` }} />

        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="flex-1 min-w-0">
              {label && (
                <span
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full mb-2"
                  style={{ background: colors.badge, color: colors.text, border: `1px solid ${colors.stroke}40` }}
                >
                  <AlertTriangle className="w-3 h-3" />
                  {label}
                </span>
              )}
              <h2 className="text-xl font-bold text-white leading-tight" style={{ letterSpacing: '-0.02em' }}>
                {outlook.title}
              </h2>
              {isSevere && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, padding: '4px 10px', borderRadius: 8, ...SEVERE_RISK_STYLE, fontSize: 11 }}>
                  <AlertTriangle style={{ width: 12, height: 12, flexShrink: 0 }} />
                  Risk of severe thunderstorms
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 p-2 rounded-xl transition-colors"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap gap-3 mb-5">
            {outlook.outlook_date && isValid(new Date(outlook.outlook_date)) && (
              <div className="flex items-center gap-1.5 text-xs" style={{ color: '#64748b' }}>
                <Calendar className="w-3.5 h-3.5" />
                {format(new Date(outlook.outlook_date + 'T12:00:00'), 'EEEE, dd MMMM yyyy')}
              </div>
            )}
            {outlook.updated_at && isValid(new Date(outlook.updated_at)) && (
              <div className="flex items-center gap-1.5 text-xs" style={{ color: '#64748b' }}>
                <Clock className="w-3.5 h-3.5" />
                Updated {format(new Date(outlook.updated_at), 'dd MMM, HH:mm')}
              </div>
            )}
          </div>

          {/* Graphic + Thunderstorm risks side by side if both present */}
          {(outlook.image_url || hasThunderstormRisks) && (
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 20 }}>
              {outlook.image_url && (
                <div style={{ flex: 1, borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(148,163,184,0.1)' }}>
                  <img src={outlook.image_url} alt="Outlook graphic" className="w-full object-contain" style={{ maxHeight: 300 }} />
                </div>
              )}
              {hasThunderstormRisks && (
                <ThunderstormRiskPanel risks={outlook.thunderstorm_risks} compact={!!outlook.image_url} />
              )}
            </div>
          )}

          {/* Risk area map */}
          {hasMap && (
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="w-3.5 h-3.5" style={{ color: colors.text }} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'rgba(148,163,184,0.6)' }}>Impact Areas</span>
              </div>
              <RiskMap areas={outlook.risk_areas} compact={false} />
              <div className="flex flex-wrap gap-2 mt-2">
                {[...new Set(outlook.risk_areas.map(a => a.risk_level))].map(level => {
                  const c = RISK_COLORS[level] || {};
                  return (
                    <span key={level} className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
                      style={{ background: c.badge, color: c.text, border: `1px solid ${c.stroke}40` }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: c.fill, border: `1px solid ${c.stroke}` }} />
                      {level} Risk
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Summary — WHITE text, with CSS override for any injected inline styles */}
          {outlook.summary && (
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'rgba(148,163,184,0.5)' }}>Summary</p>
              <style>{`.tcm-summary, .tcm-summary * { color: #ffffff !important; }`}</style>
              <div
                className="tcm-summary text-sm leading-relaxed"
                style={{ color: '#ffffff' }}
                dangerouslySetInnerHTML={{ __html: outlook.summary }}
              />
            </div>
          )}

          {/* Description */}
          {outlook.description && (
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'rgba(148,163,184,0.5)' }}>Description</p>
              <style>{`.tcm-desc, .tcm-desc * { color: #e2e8f0 !important; }`}</style>
              <div className="tcm-desc text-sm leading-relaxed" style={{ color: '#e2e8f0' }} dangerouslySetInnerHTML={{ __html: outlook.description }} />
            </div>
          )}

          {/* Overall Risk */}
          {outlook.overall_risk && (
            <div className="rounded-xl px-4 py-3 mb-4" style={{ background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.18)' }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#c084fc' }}>Overall Risk</p>
              <p className="text-sm" style={{ color: 'rgba(233,213,255,0.85)', lineHeight: 1.6 }}>{outlook.overall_risk}</p>
            </div>
          )}

          {/* Peak Window */}
          {outlook.peak_window && (
            <div className="flex items-center gap-3 rounded-xl px-4 py-3 mb-4" style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.14)' }}>
              <Clock className="w-4 h-4 flex-shrink-0" style={{ color: '#38bdf8' }} />
              <div>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#38bdf8' }}>Peak Window</p>
                <p className="text-sm font-bold" style={{ color: '#bae6fd' }}>{outlook.peak_window}</p>
              </div>
            </div>
          )}

          {/* 24h Peak Grid */}
          {outlook.peak_24h?.length === 8 && outlook.peak_24h.some(s => s.risk_level !== 'No Risk' || s.activity > 0) && (
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'rgba(148,163,184,0.5)' }}>24-Hour Peak Activity</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
                {outlook.peak_24h.map((slot) => {
                  const RISK_BAR = { 'No Risk': '#475569', 'Very Low': '#4ade80', 'Low': '#22c55e', 'Marginal': '#eab308', 'Moderate': '#f97316', 'High': '#ef4444' };
                  const barColor = RISK_BAR[slot.risk_level] || '#475569';
                  return (
                    <div key={slot.time} style={{ borderRadius: 8, padding: '7px 5px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', textAlign: 'center' }}>
                      <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', margin: '0 0 3px' }}>{slot.time}</p>
                      <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.1)', marginBottom: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${slot.activity}%`, background: barColor, borderRadius: 2 }} />
                      </div>
                      <p style={{ fontSize: 9, fontWeight: 700, color: barColor, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slot.risk_level}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Thunderstorm Overview */}
          {outlook.thunderstorm_overview && (
            <div className="rounded-xl px-4 py-3 mb-4" style={{ background: 'rgba(250,204,21,0.06)', border: '1px solid rgba(250,204,21,0.15)' }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#facc15' }}>⚡ Thunderstorm Overview</p>
              <p className="text-sm" style={{ color: 'rgba(254,249,195,0.8)', lineHeight: 1.6 }}>{outlook.thunderstorm_overview}</p>
            </div>
          )}

          {/* Update reason */}
          {outlook.update_reason && (
            <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.15)' }}>
              <p className="text-xs font-semibold text-amber-400 mb-1">Update note</p>
              <p className="text-sm text-amber-200/70">{outlook.update_reason}</p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Today/Tomorrow switcher ─────────────────────────────────────────────────
function OutlookSwitcher({ outlooks, selectedIndex, onChange }) {
  if (outlooks.length < 2) return null;

  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: 4,
        marginBottom: 20,
      }}
    >
      {outlooks.map((o, i) => {
        const isSelected = selectedIndex === i;
        const label = o.is_today ? 'Today' : o.is_tomorrow ? 'Tomorrow' : format(new Date(o.outlook_date + 'T12:00:00'), 'EEE d MMM');
        const colors = RISK_COLORS[o.risk_level] || RISK_COLORS['Marginal'];
        return (
          <button
            key={o.id}
            onClick={() => onChange(i)}
            style={{
              flex: 1,
              padding: '8px 14px',
              borderRadius: 10,
              border: isSelected ? `1px solid ${colors.stroke}50` : '1px solid transparent',
              background: isSelected ? colors.badge : 'transparent',
              color: isSelected ? colors.text : '#475569',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <span>{label}</span>
            {o.outlook_date && isValid(new Date(o.outlook_date)) && (
              <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.7 }}>
                {format(new Date(o.outlook_date + 'T12:00:00'), 'dd MMM')}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Active outlook card ─────────────────────────────────────────────────────
function ActiveOutlookCard({ outlooks, startIndex = 0 }) {
  const [selectedIndex, setSelectedIndex] = useState(startIndex);
  const [expanded, setExpanded] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [showRiskMap, setShowRiskMap] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const mapContainerRef = useRef(null);
  const outlook = outlooks[selectedIndex];
  const hasMultiple = outlooks.length > 1;

  // Reset to first when outlook list changes
  useEffect(() => { setSelectedIndex(0); }, [outlooks.length]);

  // Auto-advance when playing
  useEffect(() => {
    if (!playing || !hasMultiple) return;
    const id = setInterval(() => {
      setSelectedIndex(i => (i + 1) % outlooks.length);
    }, 2500);
    return () => clearInterval(id);
  }, [playing, hasMultiple, outlooks.length]);

  const label = riskLabel(outlook.risk_levels, outlook.risk_level);
  const colors = RISK_COLORS[outlook.risk_level] || RISK_COLORS['Marginal'];
  const hasMap = outlook.risk_areas?.length > 0;
  const hasThunderstormRisks = outlook.thunderstorm_risks && Object.keys(outlook.thunderstorm_risks).length > 0;
  const hasGraphic = !!outlook.image_url;
  const isSevere = !!outlook.thunderstorm_risks?.severe;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      style={{
        borderRadius: 24,
        overflow: 'hidden',
        background: 'linear-gradient(145deg, rgba(30,41,59,0.8) 0%, rgba(15,23,42,0.9) 100%)',
        border: '1px solid rgba(148,163,184,0.1)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        backdropFilter: 'blur(16px)',
      }}
    >
      {/* Colour accent top bar — animates on switch */}
      <motion.div
        key={outlook.id + '-bar'}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{ height: 3, background: `linear-gradient(90deg, ${colors.stroke}, ${colors.fill} 50%, transparent)` }}
      />

      <div style={{ padding: 20 }}>
        {/* TCM logo — always shown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <img
            src="https://media.base44.com/images/public/69945c97e07811f2b5427aa6/13b80d986_IMG_73723.png"
            alt="TCM"
            style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 6 }}
          />
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(167,139,250,0.7)' }}>TCM Outlook</span>
        </div>

        {/* Play/pause + risk overlay toggle */}
        {(hasMultiple || hasMap || hasGraphic) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button
              onClick={() => setPlaying(p => !p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 10, cursor: 'pointer',
                background: playing ? 'rgba(248,113,113,0.15)' : 'rgba(74,222,128,0.15)',
                border: `1px solid ${playing ? 'rgba(248,113,113,0.4)' : 'rgba(74,222,128,0.4)'}`,
                color: playing ? '#f87171' : '#4ade80',
                fontSize: 11, fontWeight: 700,
              }}
            >
              {playing ? <Pause style={{ width: 12, height: 12 }} /> : <Play style={{ width: 12, height: 12 }} />}
              {playing ? 'Pause' : 'Play'}
            </button>
            {hasMap && (
              <button
                onClick={() => setShowRiskMap(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 10, cursor: 'pointer',
                  background: showRiskMap ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${showRiskMap ? 'rgba(167,139,250,0.4)' : 'rgba(255,255,255,0.1)'}`,
                  color: showRiskMap ? '#a78bfa' : '#64748b',
                  fontSize: 11, fontWeight: 700,
                }}
              >
                {showRiskMap ? <Eye style={{ width: 12, height: 12 }} /> : <EyeOff style={{ width: 12, height: 12 }} />}
                Map
              </button>
            )}
            {/* Download outlook */}
            <button
              onClick={async () => {
                if (downloading) return;
                setDownloading(true);
                try {
                  await downloadOutlookAsImage(
                    mapContainerRef.current,
                    `TCM_Outlook_${outlook.outlook_date || new Date().toISOString().slice(0,10)}`,
                    outlook
                  );
                } finally { setDownloading(false); }
              }}
              title="Download outlook as image"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 10, cursor: downloading ? 'wait' : 'pointer',
                background: 'rgba(56,189,248,0.10)',
                border: '1px solid rgba(56,189,248,0.25)',
                color: '#38bdf8', fontSize: 11, fontWeight: 700,
                opacity: downloading ? 0.6 : 1,
              }}
            >
              <Download style={{ width: 12, height: 12 }} />
              {downloading ? 'Saving…' : 'Save'}
            </button>
            {hasMultiple && playing && outlooks.length > 1 && (
              <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 999, overflow: 'hidden', minWidth: 80 }}>
                <motion.div
                  key={selectedIndex}
                  initial={{ width: '0%' }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 2.5, ease: 'linear' }}

                  style={{ height: '100%', background: 'linear-gradient(90deg,#a78bfa,#38bdf8)' }}
                />
              </div>
            )}
          </div>
        )}

        {/* Today / Tomorrow switcher */}
        {outlooks.length > 1 && (
          <OutlookSwitcher
            outlooks={outlooks}
            selectedIndex={selectedIndex}
            onChange={(i) => { setPlaying(false); setSelectedIndex(i); }}
          />
        )}

        {/* Card header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              {outlook.is_today && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: 'rgba(56,189,248,0.15)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.25)' }}>
                  Today
                </span>
              )}
              {outlook.is_tomorrow && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)' }}>
                  Tomorrow
                </span>
              )}
              {outlook.forecast_type === 'initial' && (
                <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 999, background: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.2)' }}>
                  Initial Forecast
                </span>
              )}
              {outlook.forecast_type === 'update' && (
                <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 999, background: 'rgba(251,146,60,0.12)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.2)' }}>
                  Update {outlook.update_number ? `#${outlook.update_number}` : ''}
                </span>
              )}
              {label && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: colors.badge, color: colors.text, border: `1px solid ${colors.stroke}50` }}>
                  <AlertTriangle style={{ width: 11, height: 11 }} />
                  {label}
                </span>
              )}
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em', margin: 0 }}>
              {outlook.title}
            </h3>
            {outlook.outlook_date && isValid(new Date(outlook.outlook_date)) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, color: '#475569', fontSize: 11 }}>
                <Calendar style={{ width: 12, height: 12 }} />
                {format(new Date(outlook.outlook_date + 'T12:00:00'), 'EEEE, dd MMMM yyyy')}
              </div>
            )}
            {/* Severe thunderstorm risk — shown independently of the overall risk band */}
            {isSevere && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, padding: '4px 10px', borderRadius: 8, ...SEVERE_RISK_STYLE, fontSize: 11 }}>
                <AlertTriangle style={{ width: 12, height: 12, flexShrink: 0 }} />
                Risk of severe thunderstorms
              </div>
            )}
          </div>

          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.08)',
              background: expanded ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
              color: '#64748b',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {expanded ? <><ChevronUp style={{ width: 14, height: 14 }} /> Less</> : <><ChevronDown style={{ width: 14, height: 14 }} /> Details</>}
          </button>
        </div>

        {/* Graphic + Thunderstorm risks — always visible, side by side */}
        {(hasGraphic || hasThunderstormRisks) && (
          <AnimatePresence mode="wait">
            <motion.div
              key={outlook.id}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}
            >
              {hasGraphic && (
                <div style={{ flex: 1, borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(148,163,184,0.08)' }}>
                  <img src={outlook.image_url} alt="Outlook graphic" style={{ width: '100%', objectFit: 'contain', maxHeight: 280, display: 'block' }} />
                </div>
              )}
              {hasThunderstormRisks && (
                <ThunderstormRiskPanel risks={outlook.thunderstorm_risks} compact={hasGraphic} />
              )}
            </motion.div>
          </AnimatePresence>
        )}

        {/* Expandable section */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4 }}>
                {/* Risk area map */}
                {hasMap && showRiskMap && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <MapPin style={{ width: 13, height: 13, color: colors.text, flexShrink: 0 }} />
                      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(148,163,184,0.5)' }}>
                        Impact Areas
                      </span>
                    </div>

                    {/* Map container — ref for screenshot */}
                    <div ref={mapContainerRef}>
                      <RiskMap
                        areas={outlook.risk_areas}
                        compact={true}
                      />
                    </div>

                    {/* Legend */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {[...new Set((outlook.risk_areas || []).map(a => a.risk_level))].map(level => {
                        const c = RISK_COLORS[level] || {};
                        return (
                          <span key={level} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: c.badge, color: c.text, border: `1px solid ${c.stroke}40` }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.fill, border: `1px solid ${c.stroke}`, display: 'inline-block' }} />
                            {level} Risk
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Summary — WHITE text, with CSS override for any injected inline styles */}
                {outlook.summary && (
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>
                      Summary
                    </p>
                    <style>{`.tcm-summary, .tcm-summary * { color: #ffffff !important; }`}</style>
                    <div
                      className="tcm-summary"
                      style={{ fontSize: 13, lineHeight: 1.65, color: '#ffffff' }}
                      dangerouslySetInnerHTML={{ __html: outlook.summary }}
                    />
                  </div>
                )}

                {/* Description */}
                {outlook.description && (
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>
                      Description
                    </p>
                    <style>{`.tcm-desc, .tcm-desc * { color: #e2e8f0 !important; }`}</style>
                    <div
                      className="tcm-desc"
                      style={{ fontSize: 13, lineHeight: 1.65, color: '#e2e8f0' }}
                      dangerouslySetInnerHTML={{ __html: outlook.description }}
                    />
                  </div>
                )}

                {/* Overall Risk */}
                {outlook.overall_risk && (
                  <div style={{ borderRadius: 14, padding: '12px 16px', background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.18)' }}>
                    <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#c084fc', marginBottom: 4 }}>Overall Risk</p>
                    <p style={{ fontSize: 13, color: 'rgba(233,213,255,0.85)', margin: 0, lineHeight: 1.6 }}>{outlook.overall_risk}</p>
                  </div>
                )}

                {/* Peak Window */}
                {outlook.peak_window && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderRadius: 12, padding: '10px 14px', background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.14)' }}>
                    <Clock style={{ width: 15, height: 15, color: '#38bdf8', flexShrink: 0 }} />
                    <div>
                      <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#38bdf8', margin: 0 }}>Peak Window</p>
                      <p style={{ fontSize: 14, fontWeight: 700, color: '#bae6fd', margin: 0 }}>{outlook.peak_window}</p>
                    </div>
                  </div>
                )}

                {/* 24-Hour Peak at 3h intervals */}
                {outlook.peak_24h?.length === 8 && outlook.peak_24h.some(s => s.risk_level !== 'No Risk' || s.activity > 0) && (
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.45)', marginBottom: 10 }}>
                      24-Hour Peak Activity
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                      {outlook.peak_24h.map((slot) => {
                        const RISK_BAR = { 'No Risk': '#475569', 'Very Low': '#4ade80', 'Low': '#22c55e', 'Marginal': '#eab308', 'Moderate': '#f97316', 'High': '#ef4444' };
                        const barColor = RISK_BAR[slot.risk_level] || '#475569';
                        return (
                          <div key={slot.time} style={{ borderRadius: 10, padding: '8px 6px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', textAlign: 'center' }}>
                            <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', margin: '0 0 4px' }}>{slot.time}</p>
                            <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', marginBottom: 5, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${slot.activity}%`, background: barColor, borderRadius: 2, transition: 'width 0.3s' }} />
                            </div>
                            <p style={{ fontSize: 9, fontWeight: 700, color: barColor, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slot.risk_level}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Thunderstorm Overview */}
                {outlook.thunderstorm_overview && (
                  <div style={{ borderRadius: 14, padding: '12px 16px', background: 'rgba(250,204,21,0.06)', border: '1px solid rgba(250,204,21,0.15)' }}>
                    <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#facc15', marginBottom: 4 }}>⚡ Thunderstorm Overview</p>
                    <p style={{ fontSize: 13, color: 'rgba(254,249,195,0.8)', margin: 0, lineHeight: 1.6 }}>{outlook.thunderstorm_overview}</p>
                  </div>
                )}

                {/* Update reason */}
                {outlook.update_reason && (
                  <div style={{ borderRadius: 14, padding: '12px 16px', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.15)' }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', marginBottom: 4 }}>Update note</p>
                    <p style={{ fontSize: 12, color: 'rgba(253,230,138,0.65)', margin: 0 }}>{outlook.update_reason}</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Archive row ─────────────────────────────────────────────────────────────
function ArchiveRow({ outlook, index, onClick }) {
  const label = riskLabel(outlook.risk_levels, outlook.risk_level);
  const colors = RISK_COLORS[outlook.risk_level] || RISK_COLORS['Marginal'];
  const hasRiskData = outlook.thunderstorm_risks && Object.keys(outlook.thunderstorm_risks).length > 0;

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.4 }}
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        borderRadius: 16,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(148,163,184,0.07)',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.055)';
        e.currentTarget.style.borderColor = `${colors.stroke}40`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.025)';
        e.currentTarget.style.borderColor = 'rgba(148,163,184,0.07)';
      }}
    >
      <div style={{ width: 3, alignSelf: 'stretch', borderRadius: 999, background: colors.stroke, flexShrink: 0 }} />

      {outlook.image_url ? (
        <img src={outlook.image_url} alt="" style={{ width: 48, height: 40, objectFit: 'cover', borderRadius: 8, flexShrink: 0, border: '1px solid rgba(255,255,255,0.07)' }} />
      ) : (
        <div style={{ width: 48, height: 40, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.badge }}>
          <AlertTriangle style={{ width: 16, height: 16, color: colors.text }} />
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {outlook.title}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0 10px', marginTop: 3 }}>
          {outlook.outlook_date && isValid(new Date(outlook.outlook_date)) && (
            <span style={{ fontSize: 11, color: '#475569' }}>
              {format(new Date(outlook.outlook_date + 'T12:00:00'), 'dd MMM yyyy')}
            </span>
          )}
          {label && (
            <span style={{ fontSize: 11, fontWeight: 600, color: colors.text }}>{label}</span>
          )}
          {outlook.risk_areas?.length > 0 && (
            <span style={{ fontSize: 11, color: '#334155', display: 'flex', alignItems: 'center', gap: 3 }}>
              <MapPin style={{ width: 11, height: 11 }} />{outlook.risk_areas.length} area{outlook.risk_areas.length > 1 ? 's' : ''}
            </span>
          )}
          {hasRiskData && (
            <span style={{ fontSize: 11, color: 'rgba(139,92,246,0.7)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <Zap style={{ width: 11, height: 11 }} /> Risk data
            </span>
          )}
        </div>
      </div>

      <ZoomIn style={{ width: 14, height: 14, flexShrink: 0, color: '#334155', opacity: 0 }} className="group-hover:opacity-100 transition-opacity" />
    </motion.button>
  );
}

// ── Main TCMSection ─────────────────────────────────────────────────────────
export default function TCMSection({ outlooks = [], isOwner = false }) {
  const [selectedArchive, setSelectedArchive] = useState(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const now = new Date();

  const active = outlooks.filter(o => {
    if (o.is_today || o.is_tomorrow) return true;
    if (o.outlook_date) {
      const d = new Date(o.outlook_date + 'T23:59:59');
      return d >= now;
    }
    return false;
  });

  // Sort active: today first, then tomorrow, then by date
  const sortedActive = [...active].sort((a, b) => {
    if (a.is_today && !b.is_today) return -1;
    if (!a.is_today && b.is_today) return 1;
    if (a.is_tomorrow && !b.is_tomorrow) return -1;
    if (!a.is_tomorrow && b.is_tomorrow) return 1;
    return new Date(a.outlook_date) - new Date(b.outlook_date);
  });

  const archived = outlooks.filter(o => !active.includes(o));

  const openArchive = (o) => setSelectedArchive(o);
  const closeArchive = () => setSelectedArchive(null);

  if (outlooks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 px-6 text-center">
        <motion.div
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          className="mb-6"
        >
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto"
            style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)' }}>
            <AlertTriangle className="w-8 h-8" style={{ color: 'rgba(139,92,246,0.5)' }} />
          </div>
        </motion.div>
        <h3 className="text-xl font-bold text-white mb-2" style={{ letterSpacing: '-0.02em' }}>No active outlooks</h3>
        <p className="text-sm" style={{ color: 'rgba(148,163,184,0.5)' }}>Check back later for thunderstorm outlooks.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-16">

      {/* ── Active outlooks — all in ONE card with switcher ── */}
      {sortedActive.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          style={{ marginBottom: 40 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <span style={{ position: 'relative', display: 'flex', width: 10, height: 10 }}>
              <span style={{
                position: 'absolute', inset: 0, borderRadius: '50%', background: '#4ade80',
                animation: 'ping 1.5s cubic-bezier(0,0,0.2,1) infinite', opacity: 0.6,
              }} />
              <span style={{ position: 'relative', display: 'inline-flex', borderRadius: '50%', width: 10, height: 10, background: '#22c55e' }} />
            </span>
            <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(148,163,184,0.5)', margin: 0 }}>
              Active Outlooks
            </h2>
          </div>

          {sortedActive.length > 1 && (sortedActive[0].is_today || sortedActive[0].is_tomorrow) ? (
            <ActiveOutlookCard outlooks={sortedActive} startIndex={0} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {sortedActive.map((o) => (
                <ActiveOutlookCard key={o.id} outlooks={[o]} startIndex={0} />
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* ── Archive ── */}
      {archived.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <button
            onClick={() => setArchiveOpen(v => !v)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Archive style={{ width: 14, height: 14, color: 'rgba(148,163,184,0.4)' }} />
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)' }}>
                Archive
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', color: '#475569' }}>
                {archived.length}
              </span>
            </div>
            <motion.div animate={{ rotate: archiveOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown style={{ width: 14, height: 14, color: 'rgba(148,163,184,0.3)' }} />
            </motion.div>
          </button>

          <AnimatePresence>
            {archiveOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8 }}>
                  {archived.map((o, i) => (
                    <ArchiveRow
                      key={o.id}
                      outlook={o}
                      index={i}
                      onClick={() => openArchive(o)}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* ── Archive detail modal ── */}
      <AnimatePresence>
        {selectedArchive && (
          <ArchiveModal outlook={selectedArchive} onClose={closeArchive} />
        )}
      </AnimatePresence>
    </div>
  );
}