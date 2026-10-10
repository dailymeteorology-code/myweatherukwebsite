import React from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, X, Wind, CloudSnow, Droplets, Zap, MapPin, Navigation, Activity, Info } from 'lucide-react';
import { STORM_RISK } from '@/components/tcm/stormTracker';
import { buildStormBrief, hazardWord } from '@/components/tcm/stormHazardModel';

function hexToRgb(hex) {
  if (!hex || hex[0] !== '#') return '148,163,184';
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)].join(',');
}

/* Small labelled section header */
function SectionLabel({ icon: Icon, children, color = '#64748b' }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, margin:'0 0 8px' }}>
      {Icon && <Icon style={{ width:13, height:13, color }} />}
      <span style={{ fontSize:'0.62rem', fontWeight:800, color, letterSpacing:'0.1em', textTransform:'uppercase' }}>{children}</span>
    </div>
  );
}

/* A single hazard probability row with a bar */
function HazardBar({ icon: Icon, label, pct, accent }) {
  const word = hazardWord(pct);
  const barColor = pct >= 70 ? '#ef4444' : pct >= 45 ? '#f97316' : pct >= 25 ? '#facc15' : '#64748b';
  return (
    <div style={{ marginBottom:9 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
        <span style={{ display:'flex', alignItems:'center', gap:6, fontSize:'0.72rem', fontWeight:600, color:'#cbd5e1' }}>
          <Icon style={{ width:13, height:13, color:accent }} /> {label}
        </span>
        <span style={{ fontSize:'0.68rem', fontWeight:700, color:barColor, fontFamily:'monospace' }}>{word} · {pct}%</span>
      </div>
      <div style={{ height:5, borderRadius:3, background:'rgba(255,255,255,0.06)', overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${Math.max(3,pct)}%`, background:`linear-gradient(90deg,${barColor},${barColor}99)`, borderRadius:3, transition:'width 0.6s ease' }} />
      </div>
    </div>
  );
}

export default function StormWarningModal({ storm, onClose }) {
  if (!storm) return null;
  const cfg = STORM_RISK[storm.risk] || { color: '#f97316', label: storm.risk };
  const rgb = hexToRgb(cfg.color);
  const expiresIn = Math.max(0, Math.round((storm.expiresAt - Date.now()) / 60000));
  const expiresStr = expiresIn < 60 ? `${expiresIn}m` : `${Math.floor(expiresIn/60)}h ${expiresIn%60}m`;
  const updatedAt = storm.updatedAt ? new Date(storm.updatedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '—';

  // ── Professional brief: hazards, lifecycle, rationale, impacts, area ──
  const brief = buildStormBrief(storm);
  const { hazards, stage, motion, places, rationale, impacts } = brief;

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:0.2}}
      style={{ position:'fixed', inset:0, zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px', background:'rgba(2,6,15,0.78)', backdropFilter:'blur(8px)' }}
      onClick={onClose}>
      <motion.div initial={{opacity:0,scale:0.92,y:18}} animate={{opacity:1,scale:1,y:0}} exit={{opacity:0,scale:0.92,y:18}} transition={{duration:0.3,ease:[0.22,1,0.36,1]}}
        style={{ position:'relative', width:'100%', maxWidth:500, maxHeight:'90vh', overflowY:'auto', borderRadius:22, background:`linear-gradient(165deg, rgba(${rgb},0.18) 0%, rgba(6,13,26,0.98) 55%)`, border:`1.5px solid rgba(${rgb},0.45)`, boxShadow:`0 24px 80px rgba(0,0,0,0.75), 0 0 46px rgba(${rgb},0.16)` }}
        onClick={e => e.stopPropagation()}>
        <div style={{ height:3, background:`linear-gradient(90deg, ${cfg.color}, rgba(${rgb},0.3))`, position:'sticky', top:0, zIndex:2 }} />
        <div style={{ padding:'20px 22px' }}>

          {/* ── Header ──────────────────────────────────────────────── */}
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:14 }}>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ width:46, height:46, borderRadius:13, background:`radial-gradient(circle, rgba(${rgb},0.35), rgba(${rgb},0.08))`, border:`1.5px solid rgba(${rgb},0.5)`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, animation:'stormPulse 1.5s ease infinite' }}>
                <AlertTriangle style={{width:22,height:22,color:cfg.color,filter:`drop-shadow(0 0 5px ${cfg.color})`}}/>
              </div>
              <div>
                <p style={{ margin:0, fontSize:'1.08rem', fontWeight:800, color:cfg.color, letterSpacing:'-0.02em' }}>{cfg.fullLabel || cfg.label}</p>
                <p style={{ margin:'2px 0 0', fontSize:'0.72rem', color:'#94a3b8', fontWeight:600, display:'flex', alignItems:'center', gap:4 }}>
                  <MapPin style={{ width:11, height:11 }} /> {storm.locationLabel || 'Unknown location'}
                </p>
              </div>
            </div>
            <button onClick={onClose} style={{ background:'rgba(255,255,255,0.08)', border:'none', borderRadius:9, width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#64748b', flexShrink:0 }}><X style={{width:13,height:13}}/></button>
          </div>

          {/* ── Status chips ────────────────────────────────────────── */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:16 }}>
            <span style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 9px', borderRadius:7, background:`rgba(${hexToRgb(stage.color)},0.14)`, border:`1px solid rgba(${hexToRgb(stage.color)},0.3)`, fontSize:'0.65rem', fontWeight:700, color:stage.color }}>
              <Activity style={{ width:11, height:11 }} /> {stage.label}
            </span>
            <span style={{ padding:'4px 9px', borderRadius:7, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)', fontSize:'0.65rem', fontWeight:700, color:'#94a3b8', fontFamily:'monospace' }}>
              ⚡ {(storm.count || 0).toLocaleString()} strikes
            </span>
            <span style={{ padding:'4px 9px', borderRadius:7, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)', fontSize:'0.65rem', fontWeight:700, color:'#94a3b8', fontFamily:'monospace' }}>
              {(storm.flashRatePerMin || 0).toFixed(1)}/min
            </span>
            <span style={{ padding:'4px 9px', borderRadius:7, background:'rgba(245,158,11,0.12)', border:'1px solid rgba(245,158,11,0.28)', fontSize:'0.65rem', fontWeight:700, color:'#f59e0b', fontFamily:'monospace' }}>
              ⏱ Expires {expiresStr}
            </span>
          </div>

          {/* ── WHY THIS WARNING WAS ISSUED ─────────────────────────── */}
          <div style={{ padding:'12px 14px', borderRadius:13, background:`rgba(${rgb},0.06)`, border:`1px solid rgba(${rgb},0.18)`, marginBottom:14 }}>
            <SectionLabel icon={Info} color={cfg.color}>Why this warning was issued</SectionLabel>
            <p style={{ margin:0, fontSize:'0.78rem', lineHeight:1.6, color:'#cbd5e1' }}>{rationale}</p>
          </div>

          {/* ── HAZARD ASSESSMENT ───────────────────────────────────── */}
          <div style={{ padding:'12px 14px', borderRadius:13, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', marginBottom:14 }}>
            <SectionLabel icon={AlertTriangle} color="#f97316">Hazard assessment</SectionLabel>
            <HazardBar icon={Zap}       label="Frequent lightning" pct={hazards.frequentCG} accent="#facc15" />
            <HazardBar icon={CloudSnow} label="Large hail"         pct={hazards.hail}       accent="#a5d8ff" />
            <HazardBar icon={Wind}      label="Damaging gusts"     pct={hazards.wind}       accent="#38bdf8" />
            <HazardBar icon={Droplets}  label="Flash flooding"     pct={hazards.flood}      accent="#22d3ee" />
            <p style={{ margin:'4px 0 0', fontSize:'0.58rem', color:'#475569', fontStyle:'italic' }}>
              Estimated from lightning rate, density &amp; intensity — guidance only, not a calibrated forecast.
            </p>
          </div>

          {/* ── LIKELY IMPACTS ──────────────────────────────────────── */}
          <div style={{ padding:'12px 14px', borderRadius:13, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', marginBottom:14 }}>
            <SectionLabel icon={AlertTriangle} color="#ef4444">Likely impacts</SectionLabel>
            <ul style={{ margin:0, padding:'0 0 0 2px', listStyle:'none', display:'flex', flexDirection:'column', gap:6 }}>
              {impacts.map((line, i) => (
                <li key={i} style={{ display:'flex', gap:8, fontSize:'0.74rem', lineHeight:1.45, color:'#cbd5e1' }}>
                  <span style={{ color:cfg.color, flexShrink:0, marginTop:1 }}>▸</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* ── AREA COVERED ────────────────────────────────────────── */}
          <div style={{ padding:'12px 14px', borderRadius:13, background:'rgba(56,189,248,0.05)', border:'1px solid rgba(56,189,248,0.16)', marginBottom:14 }}>
            <SectionLabel icon={MapPin} color="#38bdf8">Area covered</SectionLabel>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10 }}>
              <div style={{ padding:'7px 10px', borderRadius:9, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.06)' }}>
                <p style={{ margin:0, fontSize:'0.56rem', color:'#475569', fontWeight:700, letterSpacing:'0.07em', textTransform:'uppercase' }}>Footprint</p>
                <p style={{ margin:'2px 0 0', fontSize:'0.82rem', fontWeight:700, color:'#e2e8f0', fontFamily:'monospace' }}>~{(storm.areaKm2 || 0).toLocaleString()} km²</p>
              </div>
              <div style={{ padding:'7px 10px', borderRadius:9, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.06)' }}>
                <p style={{ margin:0, fontSize:'0.56rem', color:'#475569', fontWeight:700, letterSpacing:'0.07em', textTransform:'uppercase' }}>Motion</p>
                <p style={{ margin:'2px 0 0', fontSize:'0.82rem', fontWeight:700, color:'#e2e8f0', fontFamily:'monospace' }}>
                  {motion.stationary ? 'Slow / static' : `${motion.compass} ${motion.speedKmH}km/h`}
                </p>
              </div>
            </div>

            {places.length > 0 && (
              <>
                <p style={{ margin:'0 0 6px', fontSize:'0.62rem', color:'#64748b', fontWeight:600 }}>
                  {places[0].km != null ? 'Nearest populated places:' : 'Populated places within the warning area:'}
                </p>
                <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                  {places.map((p, i) => (
                    <span key={i} style={{ padding:'3px 8px', borderRadius:6, background:'rgba(56,189,248,0.10)', border:'1px solid rgba(56,189,248,0.22)', fontSize:'0.66rem', color:'#7dd3fc', fontWeight:600 }}>
                      {p.name}{p.km != null ? ` (${p.km}km)` : ''}
                    </span>
                  ))}
                </div>
              </>
            )}

            {!motion.stationary && (
              <p style={{ margin:'10px 0 0', fontSize:'0.7rem', lineHeight:1.5, color:'#94a3b8', display:'flex', gap:7 }}>
                <Navigation style={{ width:12, height:12, color:'#38bdf8', flexShrink:0, marginTop:2 }} />
                <span>{motion.text}</span>
              </p>
            )}
            {storm.centroid && (
              <p style={{ margin:'8px 0 0', fontSize:'0.6rem', color:'#334155', fontFamily:'monospace' }}>
                Core centre: {Math.abs(storm.centroid.lat).toFixed(3)}°{storm.centroid.lat>=0?'N':'S'}, {Math.abs(storm.centroid.lon).toFixed(3)}°{storm.centroid.lon>=0?'E':'W'}
              </p>
            )}
          </div>

          {/* ── Footer: expiry progress + updated ───────────────────── */}
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ flex:1, height:4, borderRadius:2, background:'rgba(255,255,255,0.06)', overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${Math.min(100,Math.max(0,(1 - expiresIn/90)*100))}%`, background:`linear-gradient(90deg,${cfg.color},rgba(${rgb},0.4))`, borderRadius:2, transition:'width 1s linear' }} />
            </div>
            <span style={{ fontSize:'0.6rem', color:'#475569', fontFamily:'monospace', flexShrink:0 }}>Updated {updatedAt}</span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}