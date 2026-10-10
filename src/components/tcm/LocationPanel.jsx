import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, X, BarChart2, ChevronDown } from 'lucide-react';
import SkewT from '@/components/tcm/SkewT';

export default function LocationPanel({ data, riskType, dayIdx, run, point, onClose, t, RISK_TYPES, scoreToLevel, getPalette }) {
  // Auto-open the Skew-T sounding whenever the panel opens (i.e. whenever the
  // user clicks a new point on the map). This is the behaviour the user
  // explicitly requested: "make the Soundings bar show up when pressing on
  // the map". The user can still collapse it by tapping the header.
  const [showSounding, setShowSounding] = useState(true);
  useEffect(() => {
    if (point) setShowSounding(true);
  }, [point?.[0], point?.[1]]);
  const nearest = useMemo(() => {
    if (!point || !data?.grid) return null;
    let best = null, bd = Infinity;
    for (const p of data.grid) {
      const d = (p.lat - point[0]) ** 2 + (p.lon - point[1]) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }, [point, data]);

  if (!point || !nearest) return null;
  const sc = nearest.perDay?.[dayIdx]?.scores;
  if (!sc) return null;
  const lvl = scoreToLevel(sc[riskType] ?? 0);
  const pal = getPalette(riskType, lvl);

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0, x: 340 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 340 }} transition={{ duration: 0.32 }}
        style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 'min(440px,100vw)', zIndex: 60, background: 'linear-gradient(180deg,#0c1226,#070b18)', borderLeft: '1px solid rgba(255,255,255,0.07)', overflowY: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <MapPin style={{ width: 18, height: 18, color: pal.border }} />
          <div>
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#f1f5f9' }}>{point[0].toFixed(2)}°N, {point[1].toFixed(2)}°</h3>
            <p style={{ margin: '2px 0 0', fontSize: '0.72rem', fontWeight: 700, color: pal.border }}>{lvl} {riskType}</p>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer' }}><X style={{ width: 14, height: 14 }} /></button>
        </div>
        {RISK_TYPES.map((rt) => {
          const s = sc[rt.id] ?? 0;
          const l = scoreToLevel(s);
          const rpal = getPalette(rt.id, l);
          return (
            <div key={rt.id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <rt.icon style={{ width: 13, height: 13, color: rt.color }} />{rt.label}
                </span>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: rpal.border }}>{l} · {s}</span>
              </div>
              <div style={{ height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 99 }}>
                <div style={{ width: `${s}%`, height: '100%', background: rpal.border, borderRadius: 99 }} />
              </div>
            </div>
          );
        })}
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          {[{ label: 'CAPE', value: `${sc.metrics?.cape ?? 0} J/kg` }, { label: 'LI', value: sc.metrics?.li?.toFixed(1) ?? '—' }, { label: 'Rain', value: `${sc.metrics?.precip ?? 0} mm/h` }, { label: 'Cloud', value: `${sc.metrics?.cloud ?? 0}%` }].map((m) =>
            <div key={m.label} style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}>
              <div style={{ fontSize: '0.62rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>{m.label}</div>
              <div style={{ fontSize: '0.85rem', color: '#f1f5f9', fontWeight: 700, fontFamily: "'DM Mono',monospace", marginTop: 2 }}>{m.value}</div>
            </div>
          )}
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 14 }}>
          <button onClick={() => setShowSounding((s) => !s)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
              background: showSounding ? 'rgba(56,189,248,0.10)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${showSounding ? 'rgba(56,189,248,0.35)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 10, cursor: 'pointer', color: '#f1f5f9',
            }}>
            <BarChart2 style={{ width: 14, height: 14, color: '#38bdf8' }} />
            <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>Skew-T Sounding</span>
            <span style={{ fontSize: '0.62rem', color: '#64748b', fontFamily: "'DM Mono',monospace", marginLeft: 4 }}>
              {nearest.lat.toFixed(1)}°N, {nearest.lon.toFixed(1)}°
            </span>
            <ChevronDown style={{ width: 12, height: 12, color: '#64748b', marginLeft: 'auto', transform: showSounding ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
          </button>
          <AnimatePresence>
            {showSounding &&
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden', marginTop: 10 }}>
                <SkewT pt={nearest} dayIdx={dayIdx} run={run} t={t} lightMode={false} />
                <p style={{ margin: '8px 0 0', fontSize: '0.68rem', color: '#64748b', fontStyle: 'italic', lineHeight: 1.5 }}>
                  Vertical profile at the nearest grid point to your click. Red = temperature, green = dewpoint.
                </p>
              </motion.div>
            }
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}