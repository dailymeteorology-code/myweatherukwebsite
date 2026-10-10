/**
 * TrafficLightGraphicTool
 *
 * Premium broadcast-quality traffic-light likelihood graphic for Thunderstorms / Heatwave.
 * Three glass columns with floating circle badges, editorial header, atmospheric backdrop,
 * and a polished footer with branding. Exports as PNG via html2canvas.
 */

import React, { useRef, useState, useEffect } from 'react';
import { Download, Loader2 } from 'lucide-react';
import html2canvas from 'html2canvas';

const LEVELS = [
  {
    id: 'low', label: 'LOW',
    color: '#22c55e', colorDark: '#16a34a', bg: 'rgba(34,197,94,0.08)',
    heatwaveDesc: 'Heatwave impacts unlikely',
    thunderDesc: 'Thunderstorm impacts unlikely',
  },
  {
    id: 'mod', label: 'MOD',
    color: '#f59e0b', colorDark: '#d97706', bg: 'rgba(245,158,11,0.08)',
    heatwaveDesc: 'Heatwave possible next 5–7 days',
    thunderDesc: 'Thunderstorms possible next 5–7 days',
  },
  {
    id: 'high', label: 'HIGH',
    color: '#ef4444', colorDark: '#dc2626', bg: 'rgba(239,68,68,0.08)',
    heatwaveDesc: 'Heatwave likely next 5 days',
    thunderDesc: 'Thunderstorms likely next 5 days',
  },
];

const BG = {
  thunderstorm: 'https://media.base44.com/images/public/69945c97e07811f2b5427aa6/fd5fe1cb8_generated_image.png',
  heatwave: 'https://images.unsplash.com/photo-1504370805625-d32c54b16100?q=80&w=1600&auto=format&fit=crop',
};

const inputCss = {
  width: '100%', padding: '9px 12px', borderRadius: 10,
  background: '#101c2e', border: '1px solid rgba(148,163,184,0.18)',
  color: '#f1f5f9', fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
};
const labelCss = {
  fontSize: 10, fontWeight: 700, color: '#94a3b8',
  letterSpacing: '0.10em', textTransform: 'uppercase', display: 'block', marginBottom: 6,
};
const btnCss = {
  display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 15px',
  borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  border: '1px solid rgba(148,163,184,0.2)', color: '#f1f5f9',
  fontFamily: 'inherit', background: 'rgba(148,163,184,0.06)',
};

// ─── Premium traffic light SVG ─────────────────────────────────────────────
function TrafficLight({ active }) {
  const lamps = [
    { id: 'high', cy: 28, color: '#ef4444' },
    { id: 'mod',  cy: 62, color: '#f59e0b' },
    { id: 'low',  cy: 96, color: '#22c55e' },
  ];
  return (
    <svg width="72" height="140" viewBox="0 0 72 140">
      <defs>
        {lamps.map(l => (
          <radialGradient key={l.id} id={`tlg-${l.id}`} cx="38%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="30%" stopColor={l.color} />
            <stop offset="100%" stopColor={l.color} stopOpacity="0.9" />
          </radialGradient>
        ))}
        <linearGradient id="tl-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3f3f46" />
          <stop offset="50%" stopColor="#27272a" />
          <stop offset="100%" stopColor="#18181b" />
        </linearGradient>
        <filter id="tl-glow">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Post */}
      <rect x="32" y="120" width="8" height="20" rx="2" fill="#52525b" />
      {/* Housing */}
      <rect x="6" y="6" width="60" height="116" rx="14" fill="url(#tl-body)" stroke="#52525b" strokeWidth="2" />
      {/* Inner highlight */}
      <rect x="9" y="9" width="54" height="42" rx="11" fill="rgba(255,255,255,0.06)" />
      <rect x="11" y="14" width="50" height="2" rx="1" fill="rgba(255,255,255,0.10)" />
      {lamps.map(l => {
        const on = active === l.id;
        return (
          <g key={l.id}>
            {on && <circle cx="36" cy={l.cy} r="18" fill={l.color} opacity="0.12" filter="url(#tl-glow)" />}
            <circle cx="36" cy={l.cy} r="14"
              fill={on ? `url(#tlg-${l.id})` : 'rgba(0,0,0,0.6)'}
              stroke={on ? l.color : '#3f3f46'} strokeWidth={on ? 1.8 : 1} />
            {on && <circle cx="30" cy={l.cy - 5} r="4" fill="#fff" opacity="0.75" />}
            {on && <circle cx="33" cy={l.cy + 4} r="1.5" fill="#fff" opacity="0.35" />}
          </g>
        );
      })}
      {/* Visor hood */}
      <path d="M4 6 L10 2 L62 2 L68 6" fill="rgba(0,0,0,0.35)" />
    </svg>
  );
}

// ─── Premium checkmark ─────────────────────────────────────────────────────
function Checkmark({ color }) {
  return (
    <svg width="56" height="48" viewBox="0 0 56 48" fill="none">
      <path d="M5 25 L21 42 L51 6" stroke="#fff" strokeWidth="10"
        strokeLinecap="round" strokeLinejoin="round"
        style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))' }} />
    </svg>
  );
}

export default function TrafficLightGraphicTool({ siteLogoUrl = '' }) {
  const [weatherType, setWeatherType] = useState('thunderstorm');
  const [activeLevel, setActiveLevel] = useState('mod');
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date();
    const end = new Date(today); end.setDate(end.getDate() + 6);
    const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
    return `${fmt(today)} – ${fmt(end)}`;
  });
  const [issuer, setIssuer] = useState('@MyWeatherUK');
  const [customTitle, setCustomTitle] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const graphicRef = useRef(null);

  const GRAPHIC_W = 680, GRAPHIC_H = 540;
  const scaleWrapRef = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const measure = () => {
      const avail = scaleWrapRef.current?.offsetWidth || GRAPHIC_W;
      setScale(Math.min(1, avail / GRAPHIC_W));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const isHeat = weatherType === 'heatwave';
  const title = customTitle || (isHeat ? 'Heatwave Likelihood' : 'Thunderstorm Likelihood');
  const descKey = isHeat ? 'heatwaveDesc' : 'thunderDesc';
  const accent = isHeat ? '#f59e0b' : '#a78bfa';
  const accentRGB = isHeat ? '245,158,11' : '167,139,250';
  const activeMeta = LEVELS.find(l => l.id === activeLevel) || LEVELS[1];

  const handleDownload = async () => {
    if (!graphicRef.current) return;
    setIsExporting(true);
    try {
      const canvas = await html2canvas(graphicRef.current, {
        backgroundColor: null, scale: 2, useCORS: true, logging: false,
        width: GRAPHIC_W, height: GRAPHIC_H,
        windowWidth: GRAPHIC_W, windowHeight: GRAPHIC_H,
        x: 0, y: 0, scrollX: 0, scrollY: 0,
      });
      const link = document.createElement('a');
      link.download = `likelihood-${weatherType}-${activeLevel}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally { setIsExporting(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, color: '#f1f5f9' }}>

      {/* ── Controls ── */}
      <div style={{
        background: '#0c1422', border: '1px solid rgba(148,163,184,0.10)',
        borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <span style={labelCss}>Weather type</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {[{ id: 'thunderstorm', label: 'Thunderstorm', emoji: '⛈' }, { id: 'heatwave', label: 'Heatwave', emoji: '🌡' }].map(t => {
                const on = weatherType === t.id;
                return (
                  <button key={t.id} type="button" onClick={() => setWeatherType(t.id)} style={{
                    ...btnCss, fontWeight: 800,
                    background: on ? `${accent}18` : 'rgba(148,163,184,0.06)',
                    borderColor: on ? `${accent}55` : 'rgba(148,163,184,0.18)',
                    color: on ? accent : '#94a3b8',
                  }}>{t.emoji} {t.label}</button>
                );
              })}
            </div>
          </div>
          <div>
            <span style={labelCss}>Active level</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {LEVELS.map(l => {
                const on = activeLevel === l.id;
                return (
                  <button key={l.id} type="button" onClick={() => setActiveLevel(l.id)} style={{
                    ...btnCss, fontWeight: 800,
                    background: on ? `${l.color}20` : 'rgba(148,163,184,0.06)',
                    borderColor: on ? l.color : 'rgba(148,163,184,0.18)',
                    color: on ? l.color : '#94a3b8',
                  }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: l.color }} />
                    {l.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label style={labelCss}>Title</label>
            <input value={customTitle} onChange={e => setCustomTitle(e.target.value)}
              placeholder={isHeat ? 'Heatwave Likelihood' : 'Thunderstorm Likelihood'} style={inputCss} />
          </div>
          <div>
            <label style={labelCss}>Date range</label>
            <input value={dateRange} onChange={e => setDateRange(e.target.value)}
              placeholder="Date range" style={inputCss} />
          </div>
          <div>
            <label style={labelCss}>Handle</label>
            <input value={issuer} onChange={e => setIssuer(e.target.value)}
              placeholder="@MyWeatherUK" style={inputCss} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={handleDownload} disabled={isExporting} style={{
            ...btnCss, border: 'none', color: '#fff', fontWeight: 700,
            background: isExporting ? 'rgba(148,163,184,0.1)' : 'linear-gradient(135deg, #0284c7, #0369a1)',
            boxShadow: isExporting ? 'none' : '0 4px 16px rgba(2,132,199,0.3)',
          }}>
            {isExporting ? <Loader2 style={{ width: 14, height: 14, animation: 'spin 0.8s linear infinite' }} /> : <Download style={{ width: 14, height: 14 }} />}
            {isExporting ? 'Generating…' : 'Download PNG'}
          </button>
        </div>
      </div>

      {/* ── Graphic ── */}
      <div ref={scaleWrapRef} style={{
        width: '100%', height: GRAPHIC_H * scale, overflow: 'hidden',
        display: 'flex', justifyContent: 'center',
      }}>
        <div ref={graphicRef} style={{
          width: GRAPHIC_W, height: GRAPHIC_H, position: 'relative', overflow: 'hidden', borderRadius: 22,
          fontFamily: "'Archivo', 'DM Sans', system-ui, sans-serif",
          padding: '36px 36px 24px', background: '#06040f', flexShrink: 0, boxSizing: 'border-box',
          transform: `scale(${scale})`, transformOrigin: 'top center',
          border: '2px solid rgba(255,255,255,0.10)',
        }}>
          {/* Photo background */}
          <img src={BG[weatherType]} alt="" crossOrigin="anonymous" style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', opacity: isHeat ? 0.50 : 0.48,
          }} />
          {/* Dark wash */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(170deg, rgba(6,4,15,0.88) 0%, rgba(8,10,26,0.60) 40%, rgba(8,10,26,0.55) 70%, rgba(6,4,15,0.92) 100%)',
          }} />
          {/* Accent aura */}
          <div style={{
            position: 'absolute', top: -100, left: -60, width: 340, height: 340, borderRadius: '50%',
            background: `radial-gradient(circle, rgba(${accentRGB},0.12) 0%, transparent 70%)`, pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', bottom: -80, right: -40, width: 280, height: 280, borderRadius: '50%',
            background: `radial-gradient(circle, ${activeMeta.color}14 0%, transparent 70%)`, pointerEvents: 'none',
          }} />
          {/* Dot grid */}
          <div style={{
            position: 'absolute', inset: 0, opacity: 0.03, pointerEvents: 'none',
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.7) 0.5px, transparent 0.5px)',
            backgroundSize: '24px 24px',
          }} />
          {/* Top accent bar */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 4,
            background: `linear-gradient(90deg, ${LEVELS[0].color}, ${LEVELS[1].color}, ${LEVELS[2].color})`,
          }} />
          {/* Inner hairline frame */}
          <div style={{ position: 'absolute', inset: 10, borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', pointerEvents: 'none', zIndex: 6 }} />

          {/* ── HEADER ── */}
          <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ flex: 1 }}>
              {/* Strapline + badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.26em', textTransform: 'uppercase', color: `rgba(${accentRGB},0.95)`,
                }}>MyWeatherUK</span>
                <span style={{ width: 3, height: 3, borderRadius: '50%', background: accent, opacity: 0.7 }} />
                <span style={{
                  fontSize: 8, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase',
                  padding: '3px 10px', borderRadius: 20,
                  background: `${activeMeta.color}18`, border: `1px solid ${activeMeta.color}40`, color: activeMeta.color,
                }}>{activeMeta.label} RISK</span>
              </div>
              <h1 style={{
                margin: 0, fontSize: 42, fontWeight: 800, color: '#fff', lineHeight: 0.96,
                letterSpacing: '-0.03em', textShadow: '0 2px 10px rgba(0,0,0,0.5)',
              }}>{title}</h1>
              {/* Date pill */}
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 14,
                padding: '6px 16px', borderRadius: 999,
                background: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.18)',
                backdropFilter: 'blur(12px)',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '0.05em' }}>{dateRange}</span>
              </div>
            </div>
            <div style={{ flexShrink: 0, marginLeft: 22 }}>
              <TrafficLight active={activeLevel} />
            </div>
          </div>

          {/* ── THREE COLUMNS ── */}
          <div style={{
            position: 'relative', zIndex: 2, display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 60,
          }}>
            {LEVELS.map(level => {
              const isActive = activeLevel === level.id;
              return (
                <div key={level.id} style={{
                  position: 'relative', borderRadius: 18, overflow: 'visible',
                  transform: isActive ? 'translateY(-5px)' : 'none',
                  transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
                }}>
                  {/* Floating circle badge */}
                  <div style={{
                    position: 'absolute', top: -36, left: '50%', transform: 'translateX(-50%)',
                    width: 78, height: 78, borderRadius: '50%', zIndex: 4,
                    background: `linear-gradient(135deg, ${level.color}, ${level.colorDark})`,
                    border: '4px solid rgba(255,255,255,0.95)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: `0 6px 18px ${level.color}40, 0 2px 6px rgba(0,0,0,0.3)`,
                  }}>
                    <span style={{ fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: '0.04em', textShadow: '0 1px 3px rgba(0,0,0,0.35)' }}>{level.label}</span>
                  </div>

                  {/* Description card */}
                  <div style={{
                    marginTop: 0, paddingTop: 56, paddingBottom: 22, paddingLeft: 14, paddingRight: 14,
                    minHeight: 122, borderRadius: '16px 16px 0 0',
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.05) 100%)',
                    backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
                    border: `1px solid rgba(255,255,255,0.18)`, borderBottom: 'none',
                    boxShadow: isActive ? `inset 0 0 0 2px ${level.color}40` : 'none',
                    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                  }}>
                    {/* Glass sheen */}
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.08), transparent)',
                      borderRadius: '16px 16px 0 0', pointerEvents: 'none',
                    }} />
                    <p style={{
                      margin: 0, fontSize: 14, fontWeight: 700, color: '#fff', textAlign: 'center',
                      lineHeight: 1.4, position: 'relative', zIndex: 1,
                      textShadow: '0 1px 3px rgba(0,0,0,0.45)',
                    }}>{level[descKey]}</p>
                  </div>

                  {/* Colour result block */}
                  <div style={{
                    height: 96, borderRadius: '0 0 16px 16px',
                    background: `linear-gradient(180deg, ${level.color} 0%, ${level.colorDark} 100%)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    position: 'relative', overflow: 'hidden',
                    border: isActive ? '2.5px solid #fff' : '2px solid transparent',
                    boxShadow: isActive ? `0 4px 16px ${level.color}30` : 'none',
                  }}>
                    {/* Top sheen */}
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.15), transparent)',
                      pointerEvents: 'none',
                    }} />
                    {isActive
                      ? <Checkmark color={level.color} />
                      : <span style={{ fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>—</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── FOOTER — inline bar flush with the background, no top separator ── */}
          <div style={{
            position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', marginTop: 24,
            padding: '14px 16px',
            background: 'rgba(0,0,0,0.35)', borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {siteLogoUrl
                ? <img src={siteLogoUrl} alt="logo"
                    style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.25)', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }} />
                : <div style={{
                    width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: `linear-gradient(135deg, ${accent}, ${LEVELS[2].color})`, border: '2px solid rgba(255,255,255,0.25)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                  }}><span style={{ fontSize: 17, fontWeight: 900, color: '#fff' }}>M</span></div>}
              <div>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#fff', lineHeight: 1.1, letterSpacing: '-0.01em' }}>{issuer}</p>
                <p style={{ margin: '2px 0 0', fontSize: 8, fontWeight: 700, color: `rgba(${accentRGB},0.85)`, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                  Official Outlook · Issued {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}