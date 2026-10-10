/* ArchivePanel — extracted from pages/TCM */
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Archive, Calendar, Trash2, X, ChevronUp, ChevronDown, Camera, Loader2, Database, Palette } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const STRIKE_COLOUR_OPTIONS = [
  { id: 'age',     label: 'Age',     preview: 'linear-gradient(90deg,#fff,#facc15,#f97316,#ef4444,#7c3aed,#4c1d95)' },
  { id: 'yellow',  label: 'Yellow',  hex: '#facc15' },
  { id: 'white',   label: 'White',   hex: '#ffffff' },
  { id: 'cyan',    label: 'Cyan',    hex: '#22d3ee' },
  { id: 'lime',    label: 'Lime',    hex: '#84cc16' },
  { id: 'pink',    label: 'Pink',    hex: '#f472b6' },
  { id: 'orange',  label: 'Orange',  hex: '#f97316' },
  { id: 'red',     label: 'Red',     hex: '#ef4444' },
  { id: 'purple',  label: 'Purple',  hex: '#a78bfa' },
];

const ARCHIVE_KEY = 'tcm_lightning_archive';
function saveArchive(a) { try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(a)); } catch (_) {} }

function buildStrikeDensityGrid(strikes, cellDeg = 0.15) {
  const bins = {};
  strikes.forEach(s => {
    const latKey = Math.round(s.lat / cellDeg) * cellDeg;
    const lonKey = Math.round(s.lon / cellDeg) * cellDeg;
    const key = `${latKey.toFixed(3)}_${lonKey.toFixed(3)}`;
    if (!bins[key]) bins[key] = { lat: latKey, lon: lonKey, count: 0 };
    bins[key].count++;
  });
  return Object.values(bins);
}
function strikeDensityColor(count) {
  if (count >= 50) return { fill: '#ef4444', opacity: 0.75 };
  if (count >= 20) return { fill: '#f97316', opacity: 0.65 };
  if (count >= 8)  return { fill: '#facc15', opacity: 0.55 };
  if (count >= 3)  return { fill: '#a78bfa', opacity: 0.42 };
  if (count >= 1)  return { fill: '#7c3aed', opacity: 0.30 };
  return null;
}

function ArchivedDayMap({ day, strikeColour = 'age' }) {
  const mapRef      = useRef(null);
  const mapInst     = useRef(null);
  const containerRef = useRef(null);
  const [visible, setVisible] = useState(false);
  // Box-select state
  const [boxSelectMode, setBoxSelectMode]   = useState(false);
  const [boxResult,     setBoxResult]       = useState(null);
  const boxSelectRef    = useRef(null);
  const boxLayerRef     = useRef(null);

  function getStrikeColor(s, capturedAt, colourId) {
    if (colourId !== 'age') {
      const opt = STRIKE_COLOUR_OPTIONS.find(o => o.id === colourId);
      return opt?.hex || '#facc15';
    }
    const ageMin = (capturedAt - s.time) / 60000;
    if (ageMin < 5)    return '#ffffff';
    if (ageMin < 10)   return '#facc15';
    if (ageMin < 30)   return '#f97316';
    if (ageMin < 60)   return '#ef4444';
    if (ageMin < 360)  return '#7f1d1d';
    if (ageMin < 720)  return '#7c3aed';
    return '#4c1d95';
  }

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { threshold: 0.1 });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const L = window.L;
    if (!L || !mapRef.current || mapInst.current) return;
    const map = L.map(mapRef.current, { center: [54,-2], zoom: 5, zoomControl: false, attributionControl: false, interactive: true });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 10, subdomains: 'abcd' }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    boxLayerRef.current = L.layerGroup().addTo(map);
    const strikes = day.strikes || [];
    const grid = buildStrikeDensityGrid(strikes, 0.18);
    grid.sort((a, b) => a.count - b.count).forEach(cell => {
      const cfg = strikeDensityColor(cell.count);
      if (!cfg) return;
      const r = Math.min(28000, 5000 + cell.count * 350);
      L.circle([cell.lat, cell.lon], { radius: r, color: 'transparent', fillColor: cfg.fill, fillOpacity: cfg.opacity, weight: 0 }).addTo(layer);
    });
    const sample = strikes.length > 3000 ? strikes.filter((_,i) => i % Math.ceil(strikes.length/3000) === 0) : strikes;
    sample.forEach(s => {
      const color = getStrikeColor(s, day.capturedAt, strikeColour);
      const dot = L.circleMarker([s.lat, s.lon], { radius: 2.5, color, fillColor: color, fillOpacity: 1, weight: 0, interactive: true });
      dot.addTo(layer);
      dot.on('click', () => {
        const t = new Date(s.time);
        const timeStr = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const dateStr = t.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
        const latStr = `${Math.abs(s.lat).toFixed(4)}°${s.lat >= 0 ? 'N' : 'S'}`;
        const lonStr = `${Math.abs(s.lon).toFixed(4)}°${s.lon >= 0 ? 'E' : 'W'}`;
        dot.bindPopup(
          `<div style="background:#0f172a;border:1px solid rgba(250,204,21,0.35);border-radius:11px;padding:11px 14px;min-width:190px;font-family:system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.6)">
            <p style="margin:0 0 6px;font-size:0.82rem;font-weight:700;color:#facc15">⚡ Archived Strike</p>
            <p style="margin:0 0 3px;font-size:0.74rem;color:#e2e8f0;font-family:monospace">${dateStr}</p>
            <p style="margin:0 0 3px;font-size:0.74rem;color:#f1f5f9;font-family:monospace;font-weight:700">${timeStr}</p>
            <p style="margin:0 0 3px;font-size:0.66rem;color:#64748b;font-family:monospace">${latStr}, ${lonStr}</p>
            ${s.amp ? `<p style="margin:3px 0 0;font-size:0.68rem;color:#94a3b8">Amplitude: <b style="color:#f1f5f9">${Math.abs(s.amp)} kA</b></p>` : ''}
          </div>`,
          { className: 'blitz-popup', maxWidth: 240 }
        ).openPopup();
      });
    });
    mapInst.current = map;
    return () => { map.remove(); mapInst.current = null; boxLayerRef.current = null; };
  }, [visible, day, strikeColour]);

  // Box-select: enable/disable rectangle draw on the map
  useEffect(() => {
    const L = window.L;
    if (!L || !mapInst.current) return;
    const map = mapInst.current;
    if (!boxSelectMode) {
      map.dragging.enable();
      map.off('mousedown', boxSelectRef.current);
      boxSelectRef.current = null;
      if (boxLayerRef.current) boxLayerRef.current.clearLayers();
      setBoxResult(null);
      return;
    }
    map.dragging.disable();
    let startLatLng = null;
    let rect = null;
    const onMouseDown = (e) => {
      startLatLng = e.latlng;
      if (rect) { try { boxLayerRef.current?.removeLayer(rect); } catch(_){} rect = null; }
      setBoxResult(null);
      const onMouseMove = (ev) => {
        if (!startLatLng) return;
        const bounds = L.latLngBounds(startLatLng, ev.latlng);
        if (rect) { try { rect.setBounds(bounds); } catch(_){} }
        else {
          rect = L.rectangle(bounds, { color:'#38bdf8', weight:2, fillOpacity:0.1, dashArray:'5,4' });
          if (boxLayerRef.current) rect.addTo(boxLayerRef.current);
        }
      };
      const onMouseUp = (ev) => {
        map.off('mousemove', onMouseMove);
        map.off('mouseup', onMouseUp);
        if (!startLatLng) return;
        const bounds = L.latLngBounds(startLatLng, ev.latlng);
        const strikes = day.strikes || [];
        const count = strikes.filter(s => bounds.contains([s.lat, s.lon])).length;
        setBoxResult({ count, bounds });
        startLatLng = null;
        map.dragging.enable();
        setBoxSelectMode(false);
      };
      map.on('mousemove', onMouseMove);
      map.on('mouseup', onMouseUp);
    };
    boxSelectRef.current = onMouseDown;
    map.on('mousedown', onMouseDown);
    return () => { map.off('mousedown', onMouseDown); };
  }, [boxSelectMode, day]);

  return (
    <div ref={containerRef} style={{ width: '100%', borderRadius: 12, overflow: 'visible', background: '#0a0f1e' }}>
      {visible && (
        <>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6, flexWrap:'wrap' }}>
            <button
              onClick={() => setBoxSelectMode(v => !v)}
              style={{
                display:'flex', alignItems:'center', gap:5, padding:'5px 11px', borderRadius:8, fontSize:'0.68rem', fontWeight:700,
                background: boxSelectMode ? 'rgba(56,189,248,0.2)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${boxSelectMode ? '#38bdf8' : 'rgba(255,255,255,0.12)'}`,
                color: boxSelectMode ? '#38bdf8' : '#94a3b8', cursor:'pointer',
              }}>
              ⬜ {boxSelectMode ? 'Drawing box… click & drag' : 'Count strikes in box'}
            </button>
            {boxResult && (
              <span style={{ fontSize:'0.72rem', fontWeight:700, color:'#38bdf8', padding:'4px 10px', borderRadius:7, background:'rgba(56,189,248,0.12)', border:'1px solid rgba(56,189,248,0.3)' }}>
                ⚡ {boxResult.count.toLocaleString()} strikes in selection
              </span>
            )}
          </div>
          <div ref={mapRef} style={{ width: '100%', height: 200, borderRadius: 12, overflow: 'hidden' }} />
        </>
      )}
    </div>
  );
}

export default function ArchivePanel({ archive, setArchive, isAdmin, onForceSnapshot }) {
  const [expanded,    setExpanded]    = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);
  const [forcing,     setForcing]     = useState(false);
  const [snapOk,      setSnapOk]      = useState(false);
  const [dbSaving,    setDbSaving]    = useState(false);
  const [dbSnapOk,    setDbSnapOk]    = useState(false);
  const [dbSnapMsg,   setDbSnapMsg]   = useState('');
  const [strikeColour, setStrikeColour] = useState('age');

  const handleDelete = (dateKey, e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete archived day "${dateKey}"? This cannot be undone.`)) return;
    setArchive(prev => {
      const updated = prev.filter(d => d.date !== dateKey);
      saveArchive(updated);
      return updated;
    });
    if (selectedDay?.date === dateKey) setSelectedDay(null);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-6xl px-6 mb-16">
      {isAdmin && (
        <div style={{ marginBottom: 10, padding: '14px 16px', borderRadius: 14, background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.22)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Camera style={{ width: 15, height: 15, color: '#f59e0b' }} />
            <div>
              <p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 700, color: '#f59e0b' }}>Admin: Force Archive Snapshot</p>
              <p style={{ margin: 0, fontSize: '0.68rem', color: '#64748b' }}>Pick any time within last 24h. Strikes are saved to archive AND appear in Historical Lightning Activity, age-coloured relative to snapshot.</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>Snapshot time:</label>
            <input type="datetime-local" id="admin-snapshot-time"
              max={new Date().toISOString().slice(0, 16)}
              min={new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16)}
              defaultValue={new Date().toISOString().slice(0, 16)}
              style={{ padding: '5px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(245,158,11,0.3)', color: '#f1f5f9', fontSize: '0.74rem', colorScheme: 'dark' }}
            />
            <button onClick={() => {
              const el = document.getElementById('admin-snapshot-time');
              const selectedTime = el ? new Date(el.value).getTime() : Date.now();
              setForcing(true);
              onForceSnapshot(selectedTime).then(() => {
                setForcing(false);
                setSnapOk(true);
                setTimeout(() => setSnapOk(false), 3000);
              });
            }} disabled={forcing}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, background: forcing ? 'rgba(245,158,11,0.05)' : 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.35)', color: '#f59e0b', fontSize: '0.74rem', fontWeight: 700, cursor: forcing ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
              {forcing ? <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} /> : <Camera style={{ width: 12, height: 12 }} />}
              {forcing ? 'Saving…' : 'Force Snapshot Now'}
            </button>
            {snapOk && <span style={{ fontSize: '0.72rem', color: '#22c55e', fontWeight: 700 }}>✓ Snapshot saved locally!</span>}
          </div>

          {/* Whole-day DB snapshot */}
          <div style={{ borderTop: '1px solid rgba(245,158,11,0.15)', paddingTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Database style={{ width: 13, height: 13, color: '#38bdf8', flexShrink: 0 }} />
            <span style={{ fontSize: '0.72rem', color: '#94a3b8', flex: 1 }}>
              Save <strong>today's full DB strike record</strong> as a snapshot visible to <strong>all users</strong>.
            </span>
            <button onClick={async () => {
              setDbSaving(true); setDbSnapOk(false); setDbSnapMsg('');
              try {
                const res = await base44.functions.invoke('saveSnapshotToDB', {
                  snapshotAt: Date.now(),
                  isWholeDay: true,
                  region: 'global',
                });
                const count = res?.data?.strikeCount ?? 0;
                setDbSnapMsg(`✓ Saved ${count.toLocaleString()} strikes to DB`);
                setDbSnapOk(true);
                setTimeout(() => { setDbSnapOk(false); setDbSnapMsg(''); }, 5000);
              } catch (e) {
                setDbSnapMsg(`✗ ${e?.message || 'Failed'}`);
                setDbSnapOk(false);
              }
              setDbSaving(false);
            }} disabled={dbSaving}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, background: dbSaving ? 'rgba(56,189,248,0.05)' : 'rgba(56,189,248,0.15)', border: '1px solid rgba(56,189,248,0.35)', color: '#38bdf8', fontSize: '0.74rem', fontWeight: 700, cursor: dbSaving ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
              {dbSaving ? <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} /> : <Database style={{ width: 12, height: 12 }} />}
              {dbSaving ? 'Saving to DB…' : 'Snapshot Today → DB (All Users)'}
            </button>
            {dbSnapMsg && (
              <span style={{ fontSize: '0.72rem', color: dbSnapOk ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{dbSnapMsg}</span>
            )}
          </div>
        </div>
      )}

      {archive.length === 0 ? (
        <div style={{ padding: '24px', borderRadius: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
          <Archive style={{ width: 28, height: 28, color: '#334155', margin: '0 auto 10px' }} />
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569' }}>No archived days yet — strike data will appear here after the first midnight snapshot.</p>
        </div>
      ) : (
        <>
          <button onClick={() => setExpanded(v => !v)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', marginBottom: expanded ? 12 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Archive style={{ width: 16, height: 16, color: '#38bdf8' }} />
              </div>
              <div style={{ textAlign: 'left' }}>
                <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: '#f1f5f9' }}>Lightning Archive</p>
                <p style={{ margin: 0, fontSize: '0.72rem', color: '#64748b' }}>{archive.length} day{archive.length!==1?'s':''} stored · Auto-snapshot 23:59</p>
              </div>
            </div>
            {expanded ? <ChevronUp style={{ width: 16, height: 16, color: '#475569' }} /> : <ChevronDown style={{ width: 16, height: 16, color: '#475569' }} />}
          </button>
          <AnimatePresence>
            {expanded && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.35 }} style={{ overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 10, marginBottom: 14 }}>
                  {[...archive].reverse().map(day => (
                    <div key={day.date} style={{ position: 'relative' }}>
                      <button onClick={() => setSelectedDay(selectedDay?.date === day.date ? null : day)}
                        style={{ width: '100%', padding: '12px 14px', borderRadius: 12, textAlign: 'left', background: selectedDay?.date === day.date ? 'rgba(56,189,248,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${selectedDay?.date === day.date ? '#38bdf8' : 'rgba(255,255,255,0.07)'}`, cursor: 'pointer', paddingRight: isAdmin ? 36 : 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                          <Calendar style={{ width: 13, height: 13, color: '#38bdf8' }} />
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#e2e8f0' }}>{day.date}</span>
                          {day.isForced && <span style={{ fontSize: '0.58rem', padding: '1px 5px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontWeight: 700 }}>FORCED</span>}
                        </div>
                        <p style={{ margin: 0, fontSize: '0.7rem', color: '#64748b' }}>{(day.strikes||[]).length.toLocaleString()} strikes</p>
                        <p style={{ margin: 0, fontSize: '0.65rem', color: '#475569', marginTop: 2 }}>{day.stormCount||0} storm{day.stormCount!==1?'s':''} · Peak {day.peakHour||'—'}</p>
                      </button>
                      {isAdmin && (
                        <button onClick={(e) => handleDelete(day.date, e)}
                          style={{ position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 6, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#ef4444' }}>
                          <Trash2 style={{ width: 11, height: 11 }} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <AnimatePresence>
                  {selectedDay && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                      style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(10,15,30,0.85)' }}>
                      <div style={{ padding: '13px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: '#f1f5f9' }}>{selectedDay.date}</p>
                          <p style={{ margin: 0, fontSize: '0.72rem', color: '#64748b' }}>{(selectedDay.strikes||[]).length.toLocaleString()} strikes · {selectedDay.stormCount||0} storm systems</p>
                        </div>
                        <button onClick={() => setSelectedDay(null)} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8, width: 29, height: 29, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b' }}><X style={{ width: 13, height: 13 }} /></button>
                      </div>
                      <div style={{ padding: 16 }}>
                        {/* Colour picker */}
                        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10, flexWrap:'wrap' }}>
                          <Palette style={{ width:12, height:12, color:'#a78bfa', flexShrink:0 }} />
                          <span style={{ fontSize:'0.6rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#475569' }}>Strike colour</span>
                          {STRIKE_COLOUR_OPTIONS.map(opt => (
                            <button key={opt.id} onClick={() => setStrikeColour(opt.id)}
                              style={{
                                padding:'3px 9px', borderRadius:7, fontSize:'0.65rem', fontWeight:700, cursor:'pointer',
                                background: strikeColour === opt.id ? (opt.hex ? opt.hex + '33' : 'rgba(167,139,250,0.18)') : 'rgba(255,255,255,0.04)',
                                border: `1px solid ${strikeColour === opt.id ? (opt.hex || '#a78bfa') : 'rgba(255,255,255,0.09)'}`,
                                color: strikeColour === opt.id ? (opt.hex || '#a78bfa') : '#64748b',
                              }}>
                              {opt.id === 'age'
                                ? <span style={{ backgroundImage: opt.preview, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>{opt.label}</span>
                                : opt.label}
                            </button>
                          ))}
                        </div>
                        <ArchivedDayMap day={selectedDay} strikeColour={strikeColour} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  );
}