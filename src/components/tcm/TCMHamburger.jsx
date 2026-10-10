import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, Home, ShieldAlert, CloudLightning, ChevronRight, Sun, Moon } from 'lucide-react';
import { hamburgerPalette } from '@/components/nav/hamburgerTheme';

function Row({ item, index, p, onClose }) {
  const [hover, setHover] = useState(false);
  const I = item.icon || CloudLightning;
  return (
    <motion.a
      href={item.href}
      initial={{ opacity: 0, x: -22 }} animate={{ opacity: 1, x: 0 }}
      transition={{ delay: item.delay ?? (0.06 + index * 0.05) }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={onClose}
      style={{
        display: 'flex', alignItems: 'center', gap: 13,
        padding: '11px 14px 11px 18px', borderRadius: 14, cursor: 'pointer',
        marginBottom: 3, textDecoration: 'none',
        background: hover ? item.accent || `${item.color}18` : 'transparent',
        transition: 'background 0.16s',
      }}>
      <div style={{
        width: 34, height: 34, borderRadius: 10, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: hover ? `${item.color}22` : p.iconTileBg,
        border: `1px solid ${hover ? item.color + '4a' : p.iconTileBorder}`, transition: 'all 0.16s',
      }}>
        <I style={{ width: 15, height: 15, color: item.color }} />
      </div>
      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: hover ? item.color : p.textSecondary, flex: 1, transition: 'color 0.16s' }}>{item.label}</span>
      <ChevronRight style={{ width: 14, height: 14, color: hover ? item.color : p.textFaint, transition: 'color 0.16s' }} />
    </motion.a>);
}

export default function TCMHamburger({ lightMode, toggle, logoUrl }) {
  const [open, setOpen] = useState(false);
  const p = hamburgerPalette(!lightMode);
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);

  const items = [
    { id: 'home', label: 'Home', icon: Home, color: '#34d399', accent: 'rgba(52,211,153,0.12)', href: '/' },
    { id: 'admin', label: 'Admin Settings', icon: ShieldAlert, color: '#f59e0b', accent: 'rgba(245,158,11,0.12)', href: '/AdminSettings' },
  ];
  const otherPages = [
    { id: 'tcm', label: 'Lightning', color: '#a78bfa', icon: CloudLightning, href: '/Lightning' },
    { id: 'arch', label: 'TCM Archive', color: '#38bdf8', icon: CloudLightning, href: '/TCMArchive' },
    { id: 'tcm-verification', label: 'TCM Verification', color: '#facc15', icon: CloudLightning, href: '/TCMVerification' },
  ];

  const close = () => setOpen(false);

  return <>
    <style>{`
      .tcmham-scroll::-webkit-scrollbar { width: 5px; }
      .tcmham-scroll::-webkit-scrollbar-track { background: transparent; }
      .tcmham-scroll::-webkit-scrollbar-thumb { background: var(--tcmham-thumb); border-radius: 99px; }
    `}</style>

    <motion.button onClick={() => setOpen((o) => !o)} whileTap={{ scale: 0.9 }} aria-label={open ? 'Close menu' : 'Open menu'}
      style={{ position: 'fixed', top: 20, left: 20, zIndex: 100000, width: 46, height: 46, borderRadius: 14, background: open ? p.btnBgOpen : p.btnBg, border: `1px solid ${open ? p.btnBorderOpen : p.btnBorder}`, backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: open ? '0 0 0 1px rgba(56,189,248,0.15), 0 10px 34px rgba(0,0,0,0.3)' : '0 4px 22px rgba(0,0,0,0.22)', transition: 'background 0.25s, border-color 0.25s' }}>
      <AnimatePresence mode="wait">
        {open ? <motion.div key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}><X style={{ width: 19, height: 19, color: '#38bdf8' }} /></motion.div> :
          <motion.div key="m" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }}><Menu style={{ width: 19, height: 19, color: p.btnIcon }} /></motion.div>}
      </AnimatePresence>
    </motion.button>

    <AnimatePresence>
      {open && <>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 99998, background: p.backdrop, backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }} />
        <motion.div className="tcmham-scroll" initial={{ x: -320, opacity: 0.4 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -320, opacity: 0 }} transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          style={{ position: 'fixed', left: 0, top: 0, bottom: 0, width: 300, zIndex: 99999, background: p.panelBg, borderRight: `1px solid ${p.panelBorder}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '8px 0 40px rgba(0,0,0,0.22)', '--tcmham-thumb': p.scrollThumb }}>

          {/* Header */}
          <div style={{ padding: '26px 20px 18px', borderBottom: `1px solid ${p.headerBorder}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              {logoUrl ?
                <img src={logoUrl} alt="" style={{ width: 38, height: 38, borderRadius: 10, objectFit: 'contain', flexShrink: 0, background: p.iconTileBg, border: `1px solid ${p.iconTileBorder}`, padding: 3 }} /> :
                <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,rgba(56,189,248,0.22),rgba(167,139,250,0.22))', border: '1px solid rgba(56,189,248,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <CloudLightning style={{ width: 18, height: 18, color: '#38bdf8' }} />
                </div>}
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '1rem', fontWeight: 800, letterSpacing: '-0.02em', background: p.headingGrad, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Navigation</p>
                <p style={{ margin: 0, fontSize: '0.6rem', fontWeight: 700, color: p.textMuted, letterSpacing: '0.14em', textTransform: 'uppercase' }}>MyWeatherUK</p>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="tcmham-scroll" style={{ flex: 1, overflowY: 'auto', padding: '12px 8px 16px' }}>
            {items.map((it, i) => <Row key={it.id} item={it} index={i} p={p} onClose={close} />)}

            <div style={{ height: 1, background: p.divider, margin: '10px 6px' }} />
            {otherPages.map((it, i) => <Row key={it.id} item={{ ...it, delay: 0.2 + i * 0.05 }} index={i} p={p} onClose={close} />)}

            <div style={{ height: 1, background: p.divider, margin: '10px 6px' }} />
            <motion.button initial={{ opacity: 0, x: -22 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} whileHover={{ x: 3 }} onClick={toggle}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: '11px 14px 11px 18px', borderRadius: 14, cursor: 'pointer', background: 'transparent', border: 'none', textAlign: 'left' }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: lightMode ? 'rgba(56,189,248,0.12)' : 'rgba(250,204,21,0.12)', border: `1px solid ${lightMode ? 'rgba(56,189,248,0.4)' : 'rgba(250,204,21,0.4)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {lightMode ? <Moon style={{ width: 15, height: 15, color: '#38bdf8' }} /> : <Sun style={{ width: 15, height: 15, color: '#facc15' }} />}
              </div>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: p.textSecondary, flex: 1 }}>{lightMode ? 'Dark Mode' : 'Light Mode'}</span>
            </motion.button>
          </div>

          {/* Footer */}
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${p.headerBorder}` }}>
            <p style={{ margin: 0, fontSize: '0.6rem', fontWeight: 700, color: p.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase', textAlign: 'center' }}>Thunderstorm Convection Model</p>
          </div>
        </motion.div>
      </>}
    </AnimatePresence>
  </>;
}
