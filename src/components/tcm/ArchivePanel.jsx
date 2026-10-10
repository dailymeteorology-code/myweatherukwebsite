import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Archive, Calendar, ChevronDown, ChevronUp, X } from 'lucide-react';

function heatmapColor(count) {
  if (count >= 300) return { fill: '#ef4444', stroke: '#dc2626', opacity: 0.90 };
  if (count >= 150) return { fill: '#f97316', stroke: '#ea580c', opacity: 0.82 };
  if (count >= 30)  return { fill: '#facc15', stroke: '#ca8a04', opacity: 0.72 };
  return null;
}
function heatmapRadius(count) {
  if (count >= 300) return 28000;
  if (count >= 150) return 22000;
  if (count >= 30)  return 16000;
  return 12000;
}
function makeCircleIcon(color, size = 10) {
  // Plain filled circle — no outline, no inner highlight.
  const c = size / 2;
  const r = Math.round(size * 0.36);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${c}" cy="${c}" r="${r}" fill="${color}"/></svg>`;
}

function ArchivedDayMap({ day }) {
  const mapRef  = useRef(null);
  const mapInst = useRef(null);
  useEffect(() => {
    const L = window.L;
    if (!L || !mapRef.current || mapInst.current) return;
    const map = L.map(mapRef.current, { center: [54,-2], zoom: 5, zoomControl: false, attributionControl: false, interactive: true });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 10, subdomains: 'abcd' }).addTo(map);
    const layer   = L.layerGroup().addTo(map);
    const strikes = day.strikes || [];
    const sample  = strikes.length > 8000 ? strikes.filter((_,i) => i % Math.ceil(strikes.length/8000) === 0) : strikes;
    sample.forEach(s => {
      const dayStart = day.capturedAt - 24*3600*1000;
      const ratio    = Math.min(1, Math.max(0, (s.time - dayStart) / (24*3600*1000)));
      const hue      = Math.round(ratio * 60);
      const icon     = L.divIcon({ html: makeCircleIcon(`hsl(${hue},90%,65%)`,10), iconAnchor: [5,5], className: '' });
      L.marker([s.lat, s.lon], { icon }).addTo(layer);
    });
    if (day.omGridData) {
      day.omGridData.forEach(pt => {
        const cfg = heatmapColor(pt.recentCount || pt.dayCount || 0);
        if (!cfg) return;
        L.circle([pt.lat, pt.lon], { radius: heatmapRadius(pt.recentCount || pt.dayCount || 0), color: cfg.stroke, fillColor: cfg.fill, fillOpacity: cfg.opacity * 0.5, weight: 1 }).addTo(layer);
      });
    }
    mapInst.current = map;
    return () => { map.remove(); mapInst.current = null; };
  }, [day]);
  return <div ref={mapRef} style={{ width: '100%', height: 200, borderRadius: 12, overflow: 'hidden', background: '#0a0f1e' }} />;
}

export default function ArchivePanel({ archive }) {
  const [expanded,    setExpanded]    = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);
  if (!archive.length) return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-6xl px-6 mb-16">
      <div style={{ padding: '24px', borderRadius: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
        <Archive style={{ width: 28, height: 28, color: '#334155', margin: '0 auto 10px' }} />
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569' }}>No archived days yet — strike data will appear here after the first midnight snapshot.</p>
      </div>
    </motion.div>
  );
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-6xl px-6 mb-16">
      <button onClick={() => setExpanded(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', marginBottom: expanded ? 12 : 0 }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')} onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Archive style={{ width: 16, height: 16, color: '#38bdf8' }} />
          </div>
          <div style={{ textAlign: 'left' }}>
            <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: '#f1f5f9' }}>Lightning Archive</p>
            <p style={{ margin: 0, fontSize: '0.72rem', color: '#64748b' }}>{archive.length} day{archive.length!==1?'s':''} stored · 23:59 daily snapshot</p>
          </div>
        </div>
        {expanded ? <ChevronUp style={{ width: 16, height: 16, color: '#475569' }} /> : <ChevronDown style={{ width: 16, height: 16, color: '#475569' }} />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.35 }} style={{ overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 10, marginBottom: 14 }}>
              {[...archive].reverse().map(day => (
                <button key={day.date} onClick={() => setSelectedDay(selectedDay?.date === day.date ? null : day)}
                  style={{ padding: '12px 14px', borderRadius: 12, textAlign: 'left', background: selectedDay?.date === day.date ? 'rgba(56,189,248,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${selectedDay?.date === day.date ? '#38bdf8' : 'rgba(255,255,255,0.07)'}`, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                    <Calendar style={{ width: 13, height: 13, color: '#38bdf8' }} />
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#e2e8f0' }}>{day.date}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.7rem', color: '#64748b' }}>{(day.strikes||[]).length.toLocaleString()} strikes</p>
                  {day.omDayTotal != null && (
                    <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: '#facc15' }}>⚡ {day.omDayTotal.toLocaleString()} OM strikes</p>
                  )}
                  <p style={{ margin: 0, fontSize: '0.65rem', color: '#475569', marginTop: 2 }}>{day.stormCount||0} storm{day.stormCount!==1?'s':''} · Peak {day.peakHour||'—'}</p>
                </button>
              ))}
            </div>
            <AnimatePresence>
              {selectedDay && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                  style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(10,15,30,0.85)' }}>
                  <div style={{ padding: '13px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: '#f1f5f9' }}>{selectedDay.date}</p>
                      <p style={{ margin: 0, fontSize: '0.72rem', color: '#64748b' }}>{(selectedDay.strikes||[]).length.toLocaleString()} strikes · {selectedDay.stormCount||0} storm systems{selectedDay.omDayTotal != null ? ` · ${selectedDay.omDayTotal.toLocaleString()} OM total` : ''}</p>
                    </div>
                    <button onClick={() => setSelectedDay(null)} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8, width: 29, height: 29, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b' }}><X style={{ width: 13, height: 13 }} /></button>
                  </div>
                  <div style={{ padding: 16 }}>
                    <ArchivedDayMap day={selectedDay} />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 12 }}>
                      {[
                        { label: 'Strikes',        val: (selectedDay.strikes||[]).length.toLocaleString() },
                        { label: 'OM Total',       val: selectedDay.omDayTotal != null ? selectedDay.omDayTotal.toLocaleString() : '—' },
                        { label: 'Storm Systems',  val: selectedDay.stormCount || 0 },
                        { label: 'Peak Hour',      val: selectedDay.peakHour || '—' },
                        { label: 'OM Active Cells',val: selectedDay.omActiveCells || '—' },
                        { label: 'Max Cell Count', val: selectedDay.omMaxCell || '—' },
                      ].map(({ label, val }) => (
                        <div key={label} style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                          <p style={{ margin: 0, fontSize: '0.62rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
                          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>{val}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}