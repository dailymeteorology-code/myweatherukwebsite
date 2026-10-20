// TCMHeroSection — extracted from WeatherPatterns to keep the page editable.
// Contains TCMHero, DataStatusBar, and the Hamburger wrapper.

import React from 'react';
import { motion } from 'framer-motion';
import { CloudLightning } from 'lucide-react';
import { useTCMTheme } from '@/components/tcm/TCMThemeContext';
import TCMHamburger from '@/components/tcm/TCMHamburger';

const MYWEATHER_LOGO_URL = 'https://media.base44.com/images/public/69945c97e07811f2b5427aa6/3d6c13097_IMG_7307.PNG';
const HERO_AURORA_URL = 'https://media.base44.com/images/public/69945c97e07811f2b5427aa6/c9eb86fe0_generated_image.png';

export function TCMHero() {
  const { t, lightMode } = useTCMTheme();
  const now = new Date();
  const dayOfWeek = now.toLocaleDateString('en-GB', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <motion.section initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }}
    style={{ position: 'relative', overflow: 'hidden', padding: '44px 24px 30px', background: lightMode
      ? 'linear-gradient(155deg, #eef2ff 0%, #f0fdf4 40%, #fefce8 100%)'
      : 'linear-gradient(155deg, #060b18 0%, #0a1326 45%, #100a26 100%)',
      borderBottom: `1px solid ${lightMode ? t.cardBorder : 'rgba(120,160,230,0.16)'}` }}>
      {/* Aurora photographic backdrop (dark only) */}
      {!lightMode && (
        <div aria-hidden style={{ position:'absolute', inset:0, pointerEvents:'none',
          backgroundImage:`url(${HERO_AURORA_URL})`, backgroundSize:'cover', backgroundPosition:'center top',
          opacity:0.55, mixBlendMode:'screen', maskImage:'linear-gradient(180deg, #000 0%, #000 55%, transparent 100%)', WebkitMaskImage:'linear-gradient(180deg, #000 0%, #000 55%, transparent 100%)' }} />
      )}
      <div aria-hidden style={{ position:'absolute', inset:0, pointerEvents:'none', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:-100, left:-60, width:460, height:460, borderRadius:'50%', background:'radial-gradient(circle,rgba(56,189,248,0.16) 0%,transparent 70%)', filter:'blur(46px)' }} />
        <div style={{ position:'absolute', bottom:-70, right:-40, width:380, height:380, borderRadius:'50%', background:'radial-gradient(circle,rgba(167,139,250,0.14) 0%,transparent 70%)', filter:'blur(40px)' }} />
        <div style={{ position:'absolute', top:'28%', right:'18%', width:220, height:220, borderRadius:'50%', background:'radial-gradient(circle,rgba(52,211,153,0.08) 0%,transparent 70%)', filter:'blur(28px)' }} />
      </div>
      <div style={{ position:'relative', maxWidth:1160, margin:'0 auto', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:20 }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:20, background:lightMode?'rgba(99,102,241,0.10)':'rgba(99,102,241,0.18)', border:`1px solid ${lightMode?'rgba(99,102,241,0.25)':'rgba(99,102,241,0.35)'}` }}>
              <CloudLightning style={{ width:12, height:12, color:'#6366f1' }} />
              <span style={{ fontSize:'0.62rem', fontWeight:800, color:'#6366f1', letterSpacing:'0.12em', textTransform:'uppercase', fontFamily:"'DM Mono',monospace" }}>Weather Patterns</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 8px', borderRadius:6, background:lightMode?'rgba(34,197,94,0.08)':'rgba(34,197,94,0.12)', border:`1px solid rgba(34,197,94,0.25)` }}>
              <div style={{ width:5, height:5, borderRadius:'50%', background:'#22c55e', boxShadow:'0 0 6px #22c55e' }} />
              <span style={{ fontSize:'0.58rem', fontWeight:700, color:'#22c55e', fontFamily:"'DM Mono',monospace" }}>LIVE</span>
            </div>
          </div>
          <h1 style={{ margin:'0 0 8px', fontSize:'clamp(1.9rem,4.6vw,2.9rem)', fontWeight:900, letterSpacing:'-0.035em',
            background: lightMode
              ? 'linear-gradient(135deg,#1e1b4b 0%,#312e81 40%,#065f46 100%)'
              : 'linear-gradient(120deg,#e0f2fe 0%,#7dd3fc 28%,#a5b4fc 58%,#c4b5fd 100%)',
            WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text',
            fontFamily:"'DM Sans',system-ui,sans-serif", lineHeight:1.05,
            textShadow: lightMode ? 'none' : '0 0 40px rgba(56,189,248,0.25)' }}>
            Convective Outlook
          </h1>
          <p style={{ margin:0, fontSize:'0.88rem', color:t.textSecondary, lineHeight:1.5, maxWidth:520 }}>
            SPC-style thunderstorm risk polygons for the UK, Ireland & adjacent seas. Ensemble-driven from UKMO UKV 2km, ECMWF IFS, ECMWF AI-IFS & NCEP GEFS.
          </p>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:4, alignItems:'flex-end' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
            <img src={MYWEATHER_LOGO_URL} alt="MyWeatherUK" crossOrigin="anonymous"
              style={{ width:40, height:40, borderRadius:8, objectFit:'cover', border:'1.5px solid rgba(56,189,248,0.35)', boxShadow:'0 0 12px rgba(56,189,248,0.18)' }}
              onError={e => { e.target.style.display='none'; }} />
            <div style={{ width:1, height:32, background: lightMode ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)' }} />
            <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start' }}>
              <span style={{ fontFamily:"'DM Sans',sans-serif", fontWeight:900, fontSize:'1rem', letterSpacing:'0.14em', background:'linear-gradient(135deg,#a78bfa,#38bdf8)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>TCM</span>
              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:'0.48rem', fontWeight:700, color: lightMode?'#64748b':'#94a3b8', letterSpacing:'0.10em', textTransform:'uppercase' }}>MyWeatherUK</span>
            </div>
          </div>
          <span style={{ fontSize:'0.68rem', fontWeight:700, color:t.textMuted, letterSpacing:'0.1em', textTransform:'uppercase', fontFamily:"'DM Mono',monospace" }}>{dayOfWeek}</span>
          <span style={{ fontSize:'1.1rem', fontWeight:800, color:t.textPrimary, fontFamily:"'DM Mono',monospace" }}>{dateStr}</span>
          <div style={{ display:'flex', gap:5, marginTop:4, flexWrap:'wrap', justifyContent:'flex-end' }}>
            {['UKMO 2km','ECMWF IFS','AI-IFS','NCEP GEFS'].map(m => (
              <span key={m} style={{ fontSize:'0.55rem', padding:'2px 7px', borderRadius:4, background:lightMode?'rgba(0,0,0,0.06)':'rgba(255,255,255,0.05)', border:`1px solid ${t.cardBorder}`, color:t.textMuted, fontFamily:"'DM Mono',monospace", fontWeight:700, letterSpacing:'0.05em' }}>{m}</span>
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  );
}

export function DataStatusBar({ source, lightMode, run }) {
  const { t } = useTCMTheme();
  const sourceColor = source ? '#22c55e' : '#64748b';
  const runLabel = run ? `Run: ${run.getUTCDate().toString().padStart(2,'0')}/${(run.getUTCMonth()+1).toString().padStart(2,'0')} ${run.getUTCHours().toString().padStart(2,'0')}Z` : 'Loading…';
  return (
    <div style={{ borderBottom: `1px solid ${lightMode ? t.cardBorder : 'rgba(120,160,230,0.14)'}`, background: lightMode ? 'rgba(248,250,252,0.9)' : 'linear-gradient(180deg, rgba(10,16,34,0.92) 0%, rgba(8,13,28,0.78) 100%)', backdropFilter: 'blur(16px) saturate(1.3)', boxShadow: lightMode ? 'none' : 'inset 0 1px 0 rgba(56,189,248,0.06)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 10, overflowX: 'auto', whiteSpace: 'nowrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:20, background:`rgba(${source?'34,197,94':'100,116,139'},0.12)`, border:`1px solid rgba(${source?'34,197,94':'100,116,139'},0.30)`, flexShrink:0 }}>
          <div style={{ width:5, height:5, borderRadius:'50%', background:sourceColor, boxShadow:`0 0 5px ${sourceColor}` }} />
          <span style={{ fontSize:'0.65rem', fontWeight:800, color:sourceColor, fontFamily:"'DM Mono',monospace", letterSpacing:'0.08em' }}>
            {source ? 'OM ENSEMBLE LIVE' : 'LOADING…'}
          </span>
        </div>
        <span style={{ fontSize:'0.65rem', fontWeight:700, color:t.textMuted, fontFamily:"'DM Mono',monospace", flexShrink:0 }}>{runLabel}</span>
        <div style={{ width:1, height:16, background:t.cardBorder, flexShrink:0 }} />
        {[{ label:'UKMO UKV', sub:'2km', color:'#818cf8' },{ label:'UKMO Global', sub:'20km', color:'#818cf8' },{ label:'ECMWF IFS', sub:'0.25°', color:'#38bdf8' },{ label:'ECMWF AI', sub:'0.25°', color:'#34d399' },{ label:'NCEP GEFS', sub:'0.5°', color:'#fb923c' }].map(m => (
          <div key={m.label} style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 8px', borderRadius:6, background:lightMode?'rgba(0,0,0,0.04)':'rgba(255,255,255,0.04)', border:`1px solid ${t.cardBorder}`, flexShrink:0 }}>
            <span style={{ width:4, height:4, borderRadius:'50%', background:m.color, flexShrink:0 }} />
            <span style={{ fontSize:'0.65rem', fontWeight:700, color:t.textPrimary }}>{m.label}</span>
            <span style={{ fontSize:'0.58rem', color:t.textMuted, fontFamily:"'DM Mono',monospace" }}>{m.sub}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TCMHamburgerWrapper({ logoUrl }) {
  const { lightMode, toggle } = useTCMTheme();
  return <TCMHamburger lightMode={lightMode} toggle={toggle} logoUrl={logoUrl} />;
}