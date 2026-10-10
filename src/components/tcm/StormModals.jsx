import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Clock, CloudLightning, Wind, X, Zap } from 'lucide-react';

const STORM_RISK = {
  yellow: {
    color: '#facc15', label: 'Advisory', fullLabel: 'Yellow — Advisory',
    desc: 'Thunderstorm activity detected. Localised lightning and heavy rainfall possible. Stay alert and avoid exposed areas.',
  },
  amber: {
    color: '#f97316', label: 'Warning', fullLabel: 'Amber — Warning',
    desc: 'Active thunderstorm with frequent lightning. Potential for flash flooding, strong gusts and hail. Move indoors.',
  },
  red: {
    color: '#ef4444', label: 'Severe', fullLabel: 'Red — Severe',
    desc: 'Dangerous severe thunderstorm in progress. High likelihood of structural damage, large hail and major flooding. Take cover immediately.',
  },
};

function hexToRgb(hex) {
  const h = (hex || '#64748b').replace('#', '');
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  return `${r},${g},${b}`;
}

export function StormDetailModal({ storm, onClose }) {
  if (!storm) return null;
  const cfg = STORM_RISK[storm.risk];
  return (
    <AnimatePresence>
      <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={onClose} style={{ position:'fixed', inset:0, zIndex:9000, background:'rgba(0,0,0,0.65)', backdropFilter:'blur(8px)' }} />
      <motion.div initial={{opacity:0,scale:0.9,y:24}} animate={{opacity:1,scale:1,y:0}} exit={{opacity:0,scale:0.9,y:24}} transition={{ type:'spring', stiffness:300, damping:26 }}
        style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', zIndex:9001, width:'90%', maxWidth:468, background:'linear-gradient(160deg,#0d1829,#1a1040)', border:`1px solid ${cfg.color}45`, borderRadius:22, padding:28, boxShadow:`0 0 80px ${cfg.color}18,0 32px 80px rgba(0,0,0,0.7)` }}>
        <button onClick={onClose} style={{ position:'absolute', top:14, right:14, background:'rgba(255,255,255,0.06)', border:'none', borderRadius:8, width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#64748b' }}><X style={{width:14,height:14}}/></button>
        <div style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'5px 13px', borderRadius:9, marginBottom:16, background:`rgba(${hexToRgb(cfg.color)},0.14)`, border:`1px solid ${cfg.color}48` }}>
          <AlertTriangle style={{width:13,height:13,color:cfg.color}} />
          <span style={{ fontSize:'0.74rem', fontWeight:700, color:cfg.color }}>{cfg.fullLabel}</span>
        </div>
        <h3 style={{ margin:'0 0 4px', fontSize:'1.1rem', fontWeight:700, color:'#f1f5f9' }}>Thunderstorm Warning</h3>
        <p style={{ margin:'0 0 6px', fontSize:'0.72rem', color:'#64748b' }}>
          📍 {storm.centroid.lat.toFixed(2)}°N, {Math.abs(storm.centroid.lon).toFixed(2)}°{storm.centroid.lon>=0?'E':'W'}
          &nbsp;·&nbsp; 🕐 Active: {storm.startTime} – {storm.endTime}
        </p>
        <p style={{ margin:'0 0 18px', fontSize:'0.84rem', color:'#94a3b8', lineHeight:1.65 }}>{cfg.desc}</p>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
          {[
            {label:'First detected', val:storm.startTime,  Icon:Clock},
            {label:'Est. clear',     val:storm.endTime,    Icon:Clock},
            {label:'Strikes (30m)',  val:storm.count,      Icon:CloudLightning},
            {label:'Movement',       val:storm.direction?`${storm.direction.dLon>0?'E':'W'}${storm.direction.dLat>0?'N':'S'}`:'Stationary', Icon:Wind},
          ].map(({label,val,Icon}) => (
            <div key={label} style={{ padding:'10px 12px', borderRadius:11, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:4 }}>
                <Icon style={{width:11,height:11,color:'#64748b'}}/>
                <p style={{ margin:0, fontSize:'0.62rem', color:'#64748b', fontWeight:700, letterSpacing:'0.07em', textTransform:'uppercase' }}>{label}</p>
              </div>
              <p style={{ margin:0, fontSize:'0.92rem', fontWeight:700, color:'#e2e8f0', fontFamily:'monospace' }}>{val}</p>
            </div>
          ))}
        </div>
        <p style={{ margin:0, fontSize:'0.71rem', color:'#475569', textAlign:'center' }}>Data: Blitzortung · clustered from 30-min window</p>
      </motion.div>
    </AnimatePresence>
  );
}

export function OMCellModal({ cell, onClose }) {
  if (!cell) return null;
  return (
    <AnimatePresence>
      <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={onClose} style={{ position:'fixed', inset:0, zIndex:9000, background:'rgba(0,0,0,0.65)', backdropFilter:'blur(8px)' }} />
      <motion.div initial={{opacity:0,scale:0.9,y:24}} animate={{opacity:1,scale:1,y:0}} exit={{opacity:0,scale:0.9,y:24}} transition={{ type:'spring', stiffness:300, damping:26 }}
        style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', zIndex:9001, width:'90%', maxWidth:440, background:'linear-gradient(160deg,#0d1829,#1a1040)', border:`1px solid ${cell.risk.color}45`, borderRadius:22, padding:28, boxShadow:`0 0 80px ${cell.risk.color}18,0 32px 80px rgba(0,0,0,0.7)` }}>
        <button onClick={onClose} style={{ position:'absolute', top:14, right:14, background:'rgba(255,255,255,0.06)', border:'none', borderRadius:8, width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#64748b' }}><X style={{width:14,height:14}}/></button>
        <div style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'5px 13px', borderRadius:9, marginBottom:16, background:`rgba(${hexToRgb(cell.risk.color)},0.14)`, border:`1px solid ${cell.risk.color}48` }}>
          <Zap style={{width:13,height:13,color:cell.risk.color}} />
          <span style={{ fontSize:'0.74rem', fontWeight:700, color:cell.risk.color }}>Open-Meteo Storm Cell</span>
        </div>
        <h3 style={{ margin:'0 0 9px', fontSize:'1.1rem', fontWeight:700, color:'#f1f5f9' }}>{cell.risk.label}</h3>
        <p style={{ margin:'0 0 20px', fontSize:'0.84rem', color:'#94a3b8', lineHeight:1.65 }}>{cell.risk.desc}</p>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
          {[
            {label:'Recent Strikes (2hr)', val:cell.recentCount},
            {label:'Today Total',          val:cell.dayTotal},
            {label:'Latitude',             val:`${cell.lat.toFixed(2)}°N`},
            {label:'Longitude',            val:`${cell.lon.toFixed(2)}°E`},
          ].map(({label,val}) => (
            <div key={label} style={{ padding:'10px 12px', borderRadius:11, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)' }}>
              <p style={{ margin:0, fontSize:'0.62rem', color:'#64748b', fontWeight:700, letterSpacing:'0.07em', textTransform:'uppercase' }}>{label}</p>
              <p style={{ margin:0, fontSize:'0.92rem', fontWeight:700, color:'#e2e8f0', fontFamily:'monospace' }}>{val}</p>
            </div>
          ))}
        </div>
        <p style={{ margin:0, fontSize:'0.71rem', color:'#475569', textAlign:'center' }}>Data: Open-Meteo ERA5 archive · updated every 5 min · blob = estimated impact zone</p>
      </motion.div>
    </AnimatePresence>
  );
}