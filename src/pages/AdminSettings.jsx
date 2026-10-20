import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Save, Upload, Loader2, X, Palette, Share2, Home,
  ShieldAlert, CloudLightning, Settings, Lock,
  Menu as MenuIcon, ChevronRight, Zap,
  AlertTriangle, Megaphone, Sun, CloudRain, Eye, EyeOff,
  Check, Info, RefreshCw, Bell, Layers, Activity, Clock,
  Newspaper, History, FileImage, Plus, Trash2, Edit, Thermometer, Radio,
  Pen, Map as MapIcon, Wind, Code, Snowflake, CloudSnow
} from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import SubscriptionAnimation from '@/components/SubscriptionAnimation';
/* The real brand marks, shared with the social row on the home page so the two
   never drift apart. See that file for why they are not Lucide glyphs. */
import {
  XIcon, FacebookIcon, InstagramIcon, YouTubeIcon, DiscordIcon, BuyMeACoffeeIcon,
} from '@/components/SocialLinks';

// Real admin sub-tab components (replace placeholder tabs)
import ManualWarningsAdmin from '@/components/ManualWarningsAdmin';
import AccessRequestPanel from '@/components/AccessRequestPanel';
import InvitationLinkGenerator from '@/components/InvitationLinkGenerator';
import TCMAdmin from '@/components/TCMAdmin';
import AnnouncementsAdmin from '@/components/AnnouncementsAdmin';
import UpdatesTab from '@/components/UpdatesTab';
import StormOutlookGraphicTool from '@/components/StormOutlookGraphicTool';
import { Wind as WindIcon } from 'lucide-react';
import SnowOutlookGraphicTool from '@/components/SnowOutlookGraphicTool';
import TrafficLightGraphicTool from '@/components/TrafficLightGraphicTool';
import TemperatureMapTool from '@/components/TemperatureMapTool';
import SolarEclipseGraphicTool from '@/components/SolarEclipseGraphicTool';
import ScenarioForecastTool from '@/components/scenario/ScenarioForecastTool';
import ClimateAnomalyGraphicTool from '@/components/ClimateAnomalyGraphicTool';
import SynopticChartTool from '@/components/synoptic/SynopticChartTool';
import WeatherTypeMapTool from '@/components/synoptic/WeatherTypeMapTool';
import RelayStatusPanel from '@/components/tcm/RelayStatusPanel';
import OMDataSourcePanel from '@/components/tcm/OMDataSourcePanel';
import TCMCalibrationLab from '@/components/tcm/TCMCalibrationLab';
import SubscriptionMatrixAdmin from '@/components/SubscriptionMatrixAdmin';
import NewsletterAdmin from '@/components/NewsletterAdmin';
import SourceFilesDownloader from '@/components/SourceFilesDownloader';

// ─── Design Tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:        '#05090f',
  bgAlt:     '#080e1a',
  surface:   '#0c1422',
  surface2:  '#101c2e',
  surface3:  '#142030',
  border:    'rgba(148,163,184,0.07)',
  border2:   'rgba(148,163,184,0.12)',
  border3:   'rgba(148,163,184,0.18)',
  sky:       '#38bdf8',
  skyLow:    'rgba(56,189,248,0.06)',
  skyMed:    'rgba(56,189,248,0.12)',
  skyBorder: 'rgba(56,189,248,0.2)',
  violet:    '#a78bfa',
  violetLow: 'rgba(167,139,250,0.08)',
  green:     '#4ade80',
  greenLow:  'rgba(74,222,128,0.08)',
  amber:     '#fbbf24',
  amberLow:  'rgba(251,191,36,0.08)',
  red:       '#f87171',
  redLow:    'rgba(248,113,113,0.08)',
  text:      '#f1f5f9',
  textMid:   '#94a3b8',
  textDim:   'rgba(148,163,184,0.5)',
  textFaint: 'rgba(148,163,184,0.3)',
};

const FONT = "'Geist', 'DM Sans', system-ui, sans-serif";

// ─── Nav Items ──────────────────────────────────────────────────────────────────
const NAV = [
  { id: 'general',  label: 'General',       icon: Palette,       group: 'Site',    desc: 'Branding & identity',     color: C.sky },
  { id: 'site',     label: 'Site Control',  icon: Activity,      group: 'Site',    desc: 'Status & weather text',   color: C.sky },
  { id: 'news',     label: 'News',          icon: Newspaper,     group: 'Site',    desc: 'Homepage news section',   color: '#34d399' },
  { id: 'subscriptions', label: 'Subscriptions', icon: Layers,    group: 'Site',    desc: 'Pricing tiers & API matrix', color: '#34d399' },
  { id: 'warnings', label: 'Warnings',      icon: AlertTriangle, group: 'Content', desc: 'Manual weather alerts',   color: C.amber },
  { id: 'announce', label: 'Announcements', icon: Megaphone,     group: 'Content', desc: 'Notices & changelog',     color: C.sky },
  // Past & Future Conditions is no longer a top-level tab — it lives inside
  // Graphic Studio as one of its sections, since everything under it is a
  // graphic and having two sibling entries hid that.
  { id: 'storm-graphic', label: 'Graphic Studio', icon: FileImage, group: 'Content', desc: 'Social media & broadcast graphics', color: '#ec4899' },
  { id: 'tcm',      label: 'TCM',           icon: CloudLightning,group: 'Content', desc: 'Storm centre data',       color: '#60a5fa' },
  { id: 'newsletter', label: 'Newsletter',   icon: Bell,          group: 'Content', desc: 'Send weekly summary email', color: '#34d399' },
  { id: 'access',   label: 'Access',        icon: Lock,          group: 'Access',  desc: 'Codes & requests',        color: '#34d399' },
  { id: 'source',   label: 'Source Files',   icon: Code,           group: 'Developer', desc: 'Download tool source',  color: '#64748b' },
];
const GROUPS = ['Site', 'Content', 'Access', 'Developer'];

// ─── Shared Input Styles ────────────────────────────────────────────────────────
const inputBase = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 14px',
  background: C.surface3,
  border: `1px solid ${C.border2}`,
  borderRadius: 10,
  color: C.text,
  fontSize: 13,
  fontFamily: FONT,
  outline: 'none',
  transition: 'border-color 0.2s, box-shadow 0.2s',
  lineHeight: 1.5,
};

function StyledInput({ prefix, suffix, ...props }) {
  const [focused, setFocused] = useState(false);
  if (prefix || suffix) {
    return (
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {prefix && <div style={{ position: 'absolute', left: 12, color: C.textDim, fontSize: 13, pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>{prefix}</div>}
        <input {...props} style={{ ...inputBase, ...(prefix ? { paddingLeft: 36 } : {}), ...(suffix ? { paddingRight: 36 } : {}), ...(focused ? { borderColor: C.skyBorder, boxShadow: `0 0 0 3px ${C.skyLow}` } : {}), ...props.style }} onFocus={e => { setFocused(true); props.onFocus?.(e); }} onBlur={e => { setFocused(false); props.onBlur?.(e); }} />
        {suffix && <div style={{ position: 'absolute', right: 12, color: C.textDim, fontSize: 13, pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>{suffix}</div>}
      </div>
    );
  }
  return <input {...props} style={{ ...inputBase, ...(focused ? { borderColor: C.skyBorder, boxShadow: `0 0 0 3px ${C.skyLow}` } : {}), ...props.style }} onFocus={e => { setFocused(true); props.onFocus?.(e); }} onBlur={e => { setFocused(false); props.onBlur?.(e); }} />;
}

function StyledTextarea({ rows = 3, ...props }) {
  const [focused, setFocused] = useState(false);
  return <textarea rows={rows} {...props} style={{ ...inputBase, resize: 'vertical', ...(focused ? { borderColor: C.skyBorder, boxShadow: `0 0 0 3px ${C.skyLow}` } : {}), ...props.style }} onFocus={e => { setFocused(true); props.onFocus?.(e); }} onBlur={e => { setFocused(false); props.onBlur?.(e); }} />;
}


// ─── Toggle ─────────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, label, desc, danger }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, padding: '16px 0', borderBottom: `1px solid ${C.border}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: C.text, lineHeight: 1.4 }}>{label}</p>
        {desc && <p style={{ margin: '4px 0 0', fontSize: 12, color: C.textMid, lineHeight: 1.6 }}>{desc}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-checked={checked}
        role="switch"
        style={{
          flexShrink: 0,
          width: 46,
          height: 26,
          borderRadius: 13,
          border: 'none',
          cursor: 'pointer',
          transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
          background: checked
            ? (danger ? 'linear-gradient(135deg, #dc2626, #b91c1c)' : 'linear-gradient(135deg, #0ea5e9, #0284c7)')
            : C.surface3,
          outline: `1px solid ${checked ? 'transparent' : C.border3}`,
          position: 'relative',
          padding: 0,
        }}
      >
        <div style={{
          width: 20, height: 20, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 3, left: checked ? 23 : 3,
          transition: 'left 0.25s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {checked && <Check style={{ width: 10, height: 10, color: '#0284c7', strokeWidth: 3 }} />}
        </div>
      </button>
    </div>
  );
}

// ─── Field ───────────────────────────────────────────────────────────────────────
function Field({ label, hint, required, children, row }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {label && (
        <label style={{ fontSize: 11.5, fontWeight: 600, color: C.textMid, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
          {label}
          {required && <span style={{ color: C.red, fontSize: 12 }}>*</span>}
        </label>
      )}
      {children}
      {hint && <p style={{ margin: 0, fontSize: 11.5, color: C.textFaint, lineHeight: 1.6 }}>{hint}</p>}
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────────
function Card({ children, style = {}, glow }) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 18,
      overflow: 'hidden',
      position: 'relative',
      ...(glow ? { boxShadow: `0 0 0 1px ${glow}22, 0 8px 32px ${glow}08` } : {}),
      ...style,
    }}>
      {glow && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${glow}40, transparent)` }} />}
      {children}
    </div>
  );
}

function CardHeader({ icon: Icon, color = C.sky, title, desc, badge, badgeVariant = 'info', actions }) {
  const badgeStyles = {
    info:    { bg: C.skyMed,    text: C.sky,   border: C.skyBorder },
    success: { bg: C.greenLow,  text: C.green,  border: 'rgba(74,222,128,0.2)' },
    warning: { bg: C.amberLow,  text: C.amber,  border: 'rgba(251,191,36,0.2)' },
    danger:  { bg: C.redLow,    text: C.red,    border: 'rgba(248,113,113,0.2)' },
    violet:  { bg: C.violetLow, text: C.violet, border: 'rgba(167,139,250,0.2)' },
  };
  const bs = badgeStyles[badgeVariant] || badgeStyles.info;
  return (
    <div style={{ padding: '20px 24px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: `${color}12`, border: `1px solid ${color}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
          <Icon style={{ width: 17, height: 17, color }} />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: '-0.01em' }}>{title}</h3>
            {badge && (
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 20, letterSpacing: '0.06em', textTransform: 'uppercase', background: bs.bg, color: bs.text, border: `1px solid ${bs.border}` }}>
                {badge}
              </span>
            )}
          </div>
          {desc && <p style={{ margin: '4px 0 0', fontSize: 12, color: C.textMid, lineHeight: 1.5 }}>{desc}</p>}
        </div>
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{actions}</div>}
    </div>
  );
}

function CardBody({ children, style = {} }) {
  return <div style={{ padding: '22px 24px', ...style }}>{children}</div>;
}

// ─── Save Button ──────────────────────────────────────────────────────────────────
function SaveButton({ loading, disabled, label = 'Save Changes', icon: Icon = Save }) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      style={{
        padding: '11px 28px',
        borderRadius: 12,
        fontSize: 13,
        fontWeight: 700,
        cursor: loading || disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: loading || disabled ? C.surface3 : 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)',
        border: `1px solid ${loading || disabled ? C.border2 : 'transparent'}`,
        color: loading || disabled ? C.textDim : '#fff',
        boxShadow: loading || disabled ? 'none' : '0 4px 20px rgba(56,189,248,0.25)',
        transition: 'all 0.2s',
        fontFamily: FONT,
        letterSpacing: '-0.01em',
      }}
    >
      {loading ? <><Loader2 style={{ width: 14, height: 14, animation: 'spin 0.8s linear infinite' }} />Saving…</> : <><Icon style={{ width: 14, height: 14 }} />{label}</>}
    </button>
  );
}

// ─── Icon Button ──────────────────────────────────────────────────────────────────
function IconBtn({ icon: Icon, onClick, title, color = C.textMid, danger }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 30, height: 30, borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: hov ? (danger ? C.redLow : C.surface3) : 'transparent',
        border: `1px solid ${hov ? (danger ? 'rgba(248,113,113,0.2)' : C.border2) : 'transparent'}`,
        cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
      }}
    >
      <Icon style={{ width: 14, height: 14, color: hov && danger ? C.red : color }} />
    </button>
  );
}

// ─── Status Dot ───────────────────────────────────────────────────────────────────
function StatusDot({ active, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: active ? C.green : C.textFaint, boxShadow: active ? `0 0 0 3px ${C.greenLow}` : 'none', flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: active ? C.green : C.textDim, fontWeight: 600 }}>{label}</span>
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────────
function Sidebar({ active, setActive }) {
  return (
    <aside style={{
      width: 240, flexShrink: 0, height: '100vh', position: 'sticky', top: 0,
      display: 'flex', flexDirection: 'column',
      background: `linear-gradient(180deg, #040810 0%, ${C.bgAlt} 100%)`,
      borderRight: `1px solid ${C.border}`,
    }}>
      {/* Logo */}
      <div style={{ padding: '24px 20px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: C.skyLow, border: `1px solid ${C.skyBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ShieldAlert style={{ width: 17, height: 17, color: C.sky }} />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>Admin</p>
            <p style={{ margin: 0, fontSize: 10, color: C.textFaint, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 }}>Control Centre</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '14px 12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {GROUPS.map(group => (
          <div key={group}>
            <p style={{ margin: '0 0 8px 8px', fontSize: 10, color: C.textFaint, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700 }}>{group}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {NAV.filter(n => n.group === group).map(item => {
                const Icon = item.icon;
                const isActive = active === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActive(item.id)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 10px', borderRadius: 11,
                      border: `1px solid ${isActive ? `${item.color}25` : 'transparent'}`,
                      background: isActive ? `${item.color}08` : 'transparent',
                      cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.035)'; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 8,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      background: isActive ? `${item.color}15` : 'transparent',
                    }}>
                      <Icon style={{ width: 14, height: 14, color: isActive ? item.color : C.textFaint }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: isActive ? C.text : C.textMid, lineHeight: 1.3 }}>{item.label}</p>
                      <p style={{ margin: 0, fontSize: 10.5, color: C.textFaint, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.desc}</p>
                    </div>
                    {isActive && (
                      <div style={{ width: 4, height: 4, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom links */}
      <div style={{ padding: '12px', borderTop: `1px solid ${C.border}` }}>
        {[
          { to: '/', icon: Home, label: 'Back to Home', color: C.sky },
          { to: '/Lightning', icon: CloudLightning, label: 'Lightning', color: C.violet },
          { to: '/livestream', icon: Radio, label: 'Live Stream', color: '#e0322f' }
        ].map(({ to, icon: Icon, label, color }) => (
          <Link
            key={to} to={to}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, color: C.textDim, textDecoration: 'none', transition: 'all 0.15s', marginBottom: 2 }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textDim; }}
          >
            <Icon style={{ width: 14, height: 14, color }} />
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>
          </Link>
        ))}
      </div>
    </aside>
  );
}

// ─── Mobile Nav ──────────────────────────────────────────────────────────────────
function MobileNav({ active, setActive }) {
  const [open, setOpen] = useState(false);
  const cur = NAV.find(n => n.id === active);
  const Icon = cur?.icon ?? Settings;
  return (
    <>
      <header className="lg:hidden sticky top-0 z-40 flex items-center gap-3 px-4 h-14"
        style={{ background: 'rgba(5,9,15,0.95)', backdropFilter: 'blur(16px)', borderBottom: `1px solid ${C.border}` }}>
        <button onClick={() => setOpen(true)} style={{ padding: 7, borderRadius: 9, background: C.skyLow, border: `1px solid ${C.skyBorder}` }}>
          <MenuIcon style={{ width: 15, height: 15, color: C.sky }} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon style={{ width: 14, height: 14, color: cur?.color ?? C.sky }} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{cur?.label}</span>
        </div>
      </header>
      <AnimatePresence>
        {open && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }} />
            <motion.div initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              style={{ position: 'fixed', left: 0, top: 0, height: '100%', width: 260, zIndex: 51, background: C.bgAlt, borderRight: `1px solid ${C.border}`, overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ShieldAlert style={{ width: 16, height: 16, color: C.sky }} />
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>Admin Panel</span>
                </div>
                <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMid }}>
                  <X style={{ width: 14, height: 14 }} />
                </button>
              </div>
              <nav style={{ padding: '14px 12px' }}>
                {GROUPS.map(group => (
                  <div key={group} style={{ marginBottom: 22 }}>
                    <p style={{ margin: '0 0 8px 8px', fontSize: 10, color: C.textFaint, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700 }}>{group}</p>
                    {NAV.filter(n => n.group === group).map(item => {
                      const II = item.icon;
                      const isActive = active === item.id;
                      return (
                        <button key={item.id} onClick={() => { setActive(item.id); setOpen(false); }}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 11, border: `1px solid ${isActive ? `${item.color}25` : 'transparent'}`, background: isActive ? `${item.color}08` : 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: FONT, marginBottom: 2 }}>
                          <II style={{ width: 14, height: 14, color: isActive ? item.color : C.textFaint }} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: isActive ? C.text : C.textMid }}>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Page Header ──────────────────────────────────────────────────────────────────
function PageHeader({ tab }) {
  const item = NAV.find(n => n.id === tab);
  const Icon = item?.icon ?? Settings;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
      <div style={{ width: 44, height: 44, borderRadius: 13, background: `${item?.color ?? C.sky}10`, border: `1px solid ${item?.color ?? C.sky}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon style={{ width: 18, height: 18, color: item?.color ?? C.sky }} />
      </div>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: '-0.03em', lineHeight: 1.2 }}>{item?.label}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
          <span style={{ fontSize: 11.5, color: C.textFaint }}>Admin</span>
          <ChevronRight style={{ width: 10, height: 10, color: C.textFaint }} />
          <span style={{ fontSize: 11.5, color: C.textMid }}>{item?.label}</span>
          {item?.desc && (
            <><ChevronRight style={{ width: 10, height: 10, color: C.textFaint }} />
            <span style={{ fontSize: 11.5, color: C.textFaint }}>{item.desc}</span></>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Divider ──────────────────────────────────────────────────────────────────────
function Divider({ label }) {
  if (!label) return <div style={{ height: 1, background: C.border, margin: '4px 0' }} />;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0' }}>
      <div style={{ flex: 1, height: 1, background: C.border }} />
      <span style={{ fontSize: 10.5, color: C.textFaint, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

// ─── Info Banner ──────────────────────────────────────────────────────────────────
function InfoBanner({ icon: Icon = Info, children, variant = 'info' }) {
  const variants = {
    info:    { bg: C.skyLow,    border: C.skyBorder,              color: C.sky,   iconColor: C.sky },
    warning: { bg: C.amberLow,  border: 'rgba(251,191,36,0.2)',   color: C.amber, iconColor: C.amber },
    danger:  { bg: C.redLow,    border: 'rgba(248,113,113,0.2)',  color: C.red,   iconColor: C.red },
    success: { bg: C.greenLow,  border: 'rgba(74,222,128,0.2)',   color: C.green, iconColor: C.green },
  };
  const v = variants[variant];
  return (
    <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderRadius: 10, background: v.bg, border: `1px solid ${v.border}` }}>
      <Icon style={{ width: 14, height: 14, color: v.iconColor, flexShrink: 0, marginTop: 1 }} />
      <p style={{ margin: 0, fontSize: 12, color: v.color, lineHeight: 1.6 }}>{children}</p>
    </div>
  );
}

// ─── Image Upload Slot ────────────────────────────────────────────────────────────
/* ── Circular logo cropper ────────────────────────────────────────────────────
   The logo is round everywhere it appears on the site, so it is cut to a circle
   here rather than left to a CSS mask. A square image behind a round mask loses
   its corners at every size, and whoever picks the file cannot see what will
   survive — which is how you end up with a logo whose wordmark is clipped on
   the live site and looked fine in the file picker.

   Drag the circle to move it; drag its edge, spin the wheel, or use the slider
   to resize it. It opens on the largest circle the image can hold, which is the
   right answer often enough to simply accept. The circle is clamped inside the
   image, so the result can never contain a transparent bite out of one side,
   and what is exported is exactly what was inside it — a PNG, with everything
   outside the circle transparent. */
const CROP_STAGE = 320;      // the square the image is laid out in, CSS px
const CROP_MAX_OUT = 1024;   // cap on the exported PNG, in pixels

function LogoCropper({ src, busy, onCancel, onConfirm }) {
  const stageRef = useRef(null);
  const [img, setImg] = useState(null);       // the decoded <img>
  const [fit, setFit] = useState(null);       // where it sits inside the stage
  const [circle, setCircle] = useState(null); // { cx, cy, r }, stage coordinates
  const drag = useRef(null);

  useEffect(() => {
    let dead = false;
    const el = new window.Image();
    el.onload = () => {
      if (dead) return;
      const scale = Math.min(CROP_STAGE / el.naturalWidth, CROP_STAGE / el.naturalHeight);
      const w = el.naturalWidth * scale;
      const h = el.naturalHeight * scale;
      setImg(el);
      setFit({ scale, x: (CROP_STAGE - w) / 2, y: (CROP_STAGE - h) / 2, w, h });
      setCircle({ cx: CROP_STAGE / 2, cy: CROP_STAGE / 2, r: Math.min(w, h) / 2 });
    };
    el.onerror = () => { if (!dead) toast.error('That image could not be read'); };
    el.src = src;
    return () => { dead = true; };
  }, [src]);

  /* Whatever moved the circle, it ends up inside the picture. */
  const clamp = (c) => {
    if (!fit) return c;
    const r = Math.max(16, Math.min(c.r, Math.min(fit.w, fit.h) / 2));
    return {
      r,
      cx: Math.min(fit.x + fit.w - r, Math.max(fit.x + r, c.cx)),
      cy: Math.min(fit.y + fit.h - r, Math.max(fit.y + r, c.cy)),
    };
  };

  const pointAt = (e) => {
    const b = stageRef.current.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };

  const onPointerDown = (e) => {
    if (!circle || busy) return;
    const p = pointAt(e);
    const d = Math.hypot(p.x - circle.cx, p.y - circle.cy);
    // Near the ring resizes, anywhere else moves.
    drag.current = d > circle.r - 16
      ? { mode: 'resize' }
      : { mode: 'move', dx: p.x - circle.cx, dy: p.y - circle.cy };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!drag.current) return;
    const p = pointAt(e);
    const d = drag.current;
    setCircle((c) => clamp(d.mode === 'resize'
      ? { ...c, r: Math.hypot(p.x - c.cx, p.y - c.cy) }
      : { ...c, cx: p.x - d.dx, cy: p.y - d.dy }));
  };

  const endDrag = (e) => {
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  const onWheel = (e) => {
    if (!circle || busy) return;
    e.preventDefault();
    setCircle((c) => clamp({ ...c, r: c.r - e.deltaY * 0.25 }));
  };

  const maxR = fit ? Math.min(fit.w, fit.h) / 2 : 1;
  /* The circle measured in source pixels — what actually gets cut. */
  const outPx = img && fit && circle
    ? Math.max(64, Math.min(CROP_MAX_OUT, Math.round((circle.r / fit.scale) * 2)))
    : 0;

  /* Live preview: the same crop drawn with background-position rather than a
     second canvas, so it costs nothing while the circle is being dragged. */
  const preview = (px) => {
    if (!fit || !circle) return { width: px, height: px };
    const k = px / (circle.r * 2);
    return {
      width: px, height: px, borderRadius: '50%', flexShrink: 0,
      border: `1px solid ${C.border2}`,
      backgroundImage: `url(${src})`,
      backgroundRepeat: 'no-repeat',
      backgroundSize: `${fit.w * k}px ${fit.h * k}px`,
      backgroundPosition: `${-(circle.cx - circle.r - fit.x) * k}px ${-(circle.cy - circle.r - fit.y) * k}px`,
    };
  };

  const cut = () => {
    if (!img || !fit || !circle) return;
    const sr = circle.r / fit.scale;                 // radius, source pixels
    const scx = (circle.cx - fit.x) / fit.scale;
    const scy = (circle.cy - fit.y) / fit.scale;

    const canvas = document.createElement('canvas');
    canvas.width = outPx;
    canvas.height = outPx;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.beginPath();
    ctx.arc(outPx / 2, outPx / 2, outPx / 2, 0, Math.PI * 2);
    ctx.clip();                                      // outside the circle stays transparent
    ctx.drawImage(img, scx - sr, scy - sr, sr * 2, sr * 2, 0, 0, outPx, outPx);

    canvas.toBlob((blob) => {
      if (!blob) { toast.error('That image could not be cut'); return; }
      onConfirm(new File([blob], 'logo.png', { type: 'image/png' }));
    }, 'image/png');
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 16,
        background: 'rgba(2,6,15,0.78)', backdropFilter: 'blur(6px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.97 }}
        style={{
          width: 'min(100%, 380px)', background: C.surface, borderRadius: 18,
          border: `1px solid ${C.border3}`, padding: 18,
          boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Crop the logo</h3>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Cancel"
            style={{ background: 'none', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', color: C.textFaint, padding: 4 }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 11, color: C.textFaint, lineHeight: 1.45 }}>
          Drag the circle to move it, drag its edge or scroll to resize. Everything
          outside it is cut away.
        </p>

        <div
          ref={stageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={onWheel}
          style={{
            position: 'relative', width: '100%', maxWidth: CROP_STAGE, height: CROP_STAGE,
            margin: '0 auto', borderRadius: 12, overflow: 'hidden', touchAction: 'none',
            cursor: busy ? 'wait' : 'grab',
            background: C.bgAlt,
          }}
        >
          {fit && (
            <img src={src} alt="" draggable={false}
              style={{ position: 'absolute', left: fit.x, top: fit.y, width: fit.w, height: fit.h, userSelect: 'none' }} />
          )}
          {circle && (
            <svg width={CROP_STAGE} height={CROP_STAGE} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              <defs>
                <mask id="mwuk-logo-cut">
                  <rect width={CROP_STAGE} height={CROP_STAGE} fill="#fff" />
                  <circle cx={circle.cx} cy={circle.cy} r={circle.r} fill="#000" />
                </mask>
              </defs>
              <rect width={CROP_STAGE} height={CROP_STAGE} fill="rgba(5,9,15,0.7)" mask="url(#mwuk-logo-cut)" />
              <circle cx={circle.cx} cy={circle.cy} r={circle.r} fill="none" stroke={C.sky} strokeWidth="2" />
              <circle cx={circle.cx} cy={circle.cy + circle.r} r="5.5" fill={C.sky} stroke={C.bg} strokeWidth="1.5" />
            </svg>
          )}
        </div>

        {circle && (
          <>
            <input
              type="range" min={16} max={Math.round(maxR)} value={Math.round(circle.r)}
              onChange={(e) => setCircle((c) => clamp({ ...c, r: Number(e.target.value) }))}
              disabled={busy}
              style={{ width: '100%', marginTop: 14, accentColor: C.sky }}
              aria-label="Circle size"
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
              <div style={preview(48)} />
              <div style={preview(28)} />
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{ fontSize: 10.5, color: C.textFaint }}>Exports at</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid }}>{outPx}×{outPx}</div>
              </div>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onCancel} disabled={busy}
            style={{
              flex: 1, padding: '9px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer', color: C.textMid,
              background: 'transparent', border: `1px solid ${C.border2}`,
            }}>
            Cancel
          </button>
          <button type="button" onClick={cut} disabled={busy || !circle}
            style={{
              flex: 2, padding: '9px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700,
              cursor: busy || !circle ? 'not-allowed' : 'pointer', color: '#04121f',
              background: C.sky, border: 'none',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}>
            {busy
              ? <><Loader2 style={{ width: 13, height: 13, animation: 'spin 0.8s linear infinite' }} /> Uploading…</>
              : <><Check style={{ width: 13, height: 13 }} /> Use this crop</>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ImageSlot({ label, hint, url, uploading, onUpload, onClear, size = 80, aspect }) {
  const [hov, setHov] = useState(false);
  return (
    <Field label={label} hint={hint}>
      {url ? (
        /* Field lays its children out in a flex column, which stretches them to
           the full column width — and an inline-flex child is blockified and
           stretched with the rest. That left this wrapper as wide as the column
           while the image inside it was only as wide as its aspect ratio, so
           the clear button, pinned to the wrapper's right edge, floated off
           into the empty space beside the banner. Shrink-wrap it. */
        <div style={{ position: 'relative', display: 'inline-flex', alignSelf: 'flex-start', width: 'fit-content', borderRadius: 12, overflow: 'visible' }}>
          <img src={url} alt={label} style={{ width: aspect ? 'auto' : size, height: size, aspectRatio: aspect, objectFit: 'cover', borderRadius: 12, border: `1px solid ${C.border2}`, display: 'block' }} />
          <button type="button" onClick={onClear}
            style={{ position: 'absolute', top: -8, right: -8, width: 24, height: 24, borderRadius: '50%', background: '#dc2626', border: `2px solid ${C.bg}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <X style={{ width: 10, height: 10, color: '#fff', strokeWidth: 3 }} />
          </button>
        </div>
      ) : (
        <label
          onMouseEnter={() => setHov(true)}
          onMouseLeave={() => setHov(false)}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
            width: aspect ? '100%' : size, height: size, aspectRatio: aspect,
            border: `1.5px dashed ${hov ? C.skyBorder : C.border2}`,
            borderRadius: 12,
            background: hov ? C.skyLow : 'transparent',
            cursor: uploading ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {uploading
            ? <Loader2 style={{ width: 16, height: 16, color: C.sky, animation: 'spin 0.8s linear infinite' }} />
            : <>
                <Upload style={{ width: 16, height: 16, color: hov ? C.sky : C.textFaint }} />
                <span style={{ fontSize: 10.5, color: hov ? C.sky : C.textFaint, fontWeight: 600 }}>Upload</span>
              </>}
          <input type="file" style={{ display: 'none' }} accept="image/*" onChange={onUpload} disabled={uploading} />
        </label>
      )}
    </Field>
  );
}

// ─── Stat Chip ────────────────────────────────────────────────────────────────────

// ─── General Tab ─────────────────────────────────────────────────────────────────
function GeneralTab({ formData, setFormData, saveMutation, handleImageUpload, uploadingLogo, uploadingBanner, setPreviewAnimTier }) {
  const SOCIALS = [
    { key: 'twitter_url',   label: 'X (Twitter)',  icon: XIcon,         placeholder: 'https://x.com/yourhandle',         color: '#e7e9ea' },
    { key: 'facebook_url',  label: 'Facebook',     icon: FacebookIcon,  placeholder: 'https://facebook.com/yourpage',    color: '#1877f2' },
    { key: 'instagram_url', label: 'Instagram',    icon: InstagramIcon, placeholder: 'https://instagram.com/yourhandle', color: '#e4405f' },
    { key: 'youtube_url',   label: 'YouTube',      icon: YouTubeIcon,   placeholder: 'https://youtube.com/yourchannel',  color: '#ff0000' },
    { key: 'discord_url',   label: 'Discord',      icon: DiscordIcon,   placeholder: 'https://discord.gg/yourserver',    color: '#5865f2' },
    { key: 'buymeacoffee_url', label: 'Buy Me a Coffee (TCM support link)', icon: BuyMeACoffeeIcon, placeholder: 'https://buymeacoffee.com/yourname', color: '#ffdd00' },
  ];

  const TIERS = [
    { id: 'lite',      label: 'Lite',      color: '#60a5fa' },
    { id: 'pro',       label: 'Pro',       color: '#a78bfa' },
    { id: 'elite',     label: 'Elite',     color: '#fbbf24' },
    { id: 'developer', label: 'Dev',       color: '#34d399' },
  ];

  const charCount = formData.description?.length || 0;

  return (
    <form onSubmit={e => { e.preventDefault(); saveMutation.mutate(formData); }} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Branding */}
      <Card glow={C.sky}>
        <CardHeader icon={Palette} color={C.sky} title="Branding" desc="Define your site's identity, logo, and version string" />
        <CardBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 14 }}>
              <Field label="Site Name" required hint="This appears in the browser tab and metadata">
                <StyledInput
                  placeholder="MyWeatherUK"
                  value={formData.site_name}
                  onChange={e => setFormData(p => ({ ...p, site_name: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Version Tag" hint="e.g. v2.1.0">
                <StyledInput
                  placeholder="v1.0.0"
                  value={formData.version}
                  onChange={e => setFormData(p => ({ ...p, version: e.target.value }))}
                />
              </Field>
            </div>

            <Field label="Description / Tagline" hint={`${charCount}/160 characters · Shown in meta tags and headers`}>
              <div style={{ position: 'relative' }}>
                <StyledTextarea
                  rows={2}
                  placeholder="Your trusted source for UK weather warnings and live alerts."
                  value={formData.description}
                  onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
                  maxLength={160}
                />
                <span style={{ position: 'absolute', bottom: 10, right: 12, fontSize: 10.5, color: charCount > 140 ? C.amber : C.textFaint, fontWeight: 600 }}>{charCount}/160</span>
              </div>
            </Field>

            <Divider label="Media Assets" />

            <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 20, alignItems: 'start' }}>
              <ImageSlot
                label="Logo"
                hint="Cropped to a circle when you pick it"
                url={formData.logo_url}
                uploading={uploadingLogo}
                onUpload={e => handleImageUpload(e, 'logo')}
                onClear={() => setFormData(p => ({ ...p, logo_url: '' }))}
                size={92}
              />
              <ImageSlot
                label="Banner Image"
                hint="Recommended 1280×400px"
                url={formData.banner_url}
                uploading={uploadingBanner}
                onUpload={e => handleImageUpload(e, 'banner')}
                onClear={() => setFormData(p => ({ ...p, banner_url: '' }))}
                size={92}
                aspect="16/5"
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Social */}
      <Card glow="#34d399">
        <CardHeader icon={Share2} color="#34d399" title="Social Media Links" desc="Connect your community channels for display in the site footer and profile" />
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {SOCIALS.map(s => {
              const SIcon = s.icon;
              return (
                <Field key={s.key} label={s.label}>
                  <StyledInput
                    prefix={<SIcon style={{ width: 13, height: 13, color: s.color }} />}
                    placeholder={s.placeholder}
                    value={formData[s.key] || ''}
                    onChange={e => setFormData(p => ({ ...p, [s.key]: e.target.value }))}
                  />
                </Field>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* Subscription Animation Preview */}
      <Card glow={C.violet}>
        <CardHeader icon={Zap} color={C.violet} title="Subscription Animations" desc="Preview the upgrade celebration animations by tier" />
        <CardBody>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {TIERS.map(tier => (
              <button
                key={tier.id}
                type="button"
                onClick={() => setPreviewAnimTier(tier.id)}
                style={{
                  padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', fontFamily: FONT,
                  background: `${tier.color}10`,
                  border: `1px solid ${tier.color}28`,
                  color: tier.color,
                  transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', gap: 7,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = `${tier.color}20`; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = `${tier.color}10`; e.currentTarget.style.transform = 'none'; }}
              >
                <Zap style={{ width: 13, height: 13 }} />
                {tier.label}
              </button>
            ))}
          </div>
          <p style={{ margin: '14px 0 0', fontSize: 12, color: C.textFaint }}>Click any tier to preview the full-screen animation overlay.</p>
        </CardBody>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
        <SaveButton loading={saveMutation.isPending} disabled={!formData.site_name} />
      </div>
    </form>
  );
}

// ─── Site Control Tab ─────────────────────────────────────────────────────────────
function SiteControlTab() {
  const queryClient = useQueryClient();
  const [stormTitle, setStormTitle] = useState('');
  const [stormMsg, setStormMsg] = useState('');
  const [sunnyTitle, setSunnyTitle] = useState('');
  const [sunnyMsg, setSunnyMsg] = useState('');
  const [siteDisabled, setSiteDisabled] = useState(false);
  const [disabledTitle, setDisabledTitle] = useState('');
  const [disabledMsg, setDisabledMsg] = useState('');
  const [countdownEnabled, setCountdownEnabled] = useState(false);
  const [countdownTarget, setCountdownTarget] = useState('');
  const [countdownTitle, setCountdownTitle] = useState('');
  const [countdownDesc, setCountdownDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsId, setSettingsId] = useState(null);

  // ── Summer theme — stored in localStorage so it's instant, reliable,
  //    and never clobbered by the DB save/refetch cycle.
  const SUMMER_KEY = 'mwuk_summer_theme';
  const [summerThemeEnabled, setSummerThemeEnabled] = useState(() => {
    try { return localStorage.getItem(SUMMER_KEY) === 'true'; } catch { return false; }
  });

  const handleSummerToggle = (val) => {
    setSummerThemeEnabled(val);
    try {
      localStorage.setItem(SUMMER_KEY, String(val));
      // Broadcast to other open tabs (including the home page tab)
      window.dispatchEvent(new StorageEvent('storage', {
        key: SUMMER_KEY, newValue: String(val), storageArea: localStorage,
      }));
    } catch {}
    toast.success(val ? '☀️ Summer theme enabled' : '🌙 Default theme restored');
  };

  const { data: existingSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => { const list = await base44.entities.SiteSettings.list(); return list[0] || null; },
  });

  useEffect(() => {
    if (!existingSettings) return;
    setSettingsId(existingSettings.id);
    setSiteDisabled(existingSettings.site_disabled || false);
    setDisabledTitle(existingSettings.disabled_title || '');
    setDisabledMsg(existingSettings.disabled_message || '');
    setCountdownEnabled(existingSettings.countdown_enabled || false);
    setCountdownTarget(existingSettings.countdown_target || '');
    setCountdownTitle(existingSettings.countdown_title || '');
    setCountdownDesc(existingSettings.countdown_description || '');
    try {
      if (existingSettings.storm_text) {
        const p = JSON.parse(existingSettings.storm_text);
        setStormTitle(p.title || '');
        setStormMsg(p.message || '');
      }
      if (existingSettings.sunny_text) { const p = JSON.parse(existingSettings.sunny_text); setSunnyTitle(p.title || ''); setSunnyMsg(p.message || ''); }
    } catch {}
  }, [existingSettings]);

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      const payload = {
        site_disabled: siteDisabled,
        disabled_title: disabledTitle,
        disabled_message: disabledMsg,
        countdown_enabled: countdownEnabled,
        countdown_target: countdownTarget,
        countdown_title: countdownTitle,
        countdown_description: countdownDesc,
        storm_text: JSON.stringify({ title: stormTitle, message: stormMsg }),
        sunny_text: JSON.stringify({ title: sunnyTitle, message: sunnyMsg }),
      };
      if (settingsId) await base44.entities.SiteSettings.update(settingsId, payload);
      else await base44.entities.SiteSettings.create({ site_name: 'MyWeatherUK', ...payload });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Site settings saved');
    } catch { toast.error('Failed to save'); }
    setSaving(false);
  };

  const PHASES = [
    { label: '⛈ Storm',    dur: '40s', color: '#818cf8', bg: 'rgba(129,140,248,0.08)' },
    { label: '🌦 Clearing', dur: '40s', color: '#60a5fa', bg: 'rgba(96,165,250,0.08)' },
    { label: '☀ Sunny',    dur: '40s', color: C.amber,   bg: C.amberLow },
    { label: '🌥 Clouding', dur: '40s', color: C.textMid, bg: C.surface2 },
  ];

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Site Status */}
      <Card glow={siteDisabled ? C.red : C.green}>
        <CardHeader
          icon={Activity}
          color={siteDisabled ? C.red : C.green}
          title="Site Status"
          desc="Control whether visitors can access the live site"
          badge={siteDisabled ? 'Offline' : 'Live'}
          badgeVariant={siteDisabled ? 'danger' : 'success'}
          actions={<StatusDot active={!siteDisabled} label={siteDisabled ? 'Offline' : 'Online'} />}
        />
        <CardBody>
          {siteDisabled && (
            <div style={{ marginBottom: 18 }}>
              <InfoBanner icon={AlertTriangle} variant="warning">
                Site is currently in maintenance mode. All visitors are seeing the coming soon page.
              </InfoBanner>
            </div>
          )}
          <div>
            <Toggle
              checked={siteDisabled}
              onChange={setSiteDisabled}
              label="Maintenance Mode"
              desc="Redirect all visitors to a coming soon / maintenance page"
              danger
            />
            <Toggle
              checked={countdownEnabled}
              onChange={setCountdownEnabled}
              label="Show Countdown Timer"
              desc="Display a countdown clock on the maintenance page"
            />
          </div>

          <AnimatePresence>
            {countdownEnabled && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <Divider label="Countdown Configuration" />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <Field label="Target Date & Time" hint="Countdown ends at this moment">
                      <StyledInput type="datetime-local" value={countdownTarget} onChange={e => setCountdownTarget(e.target.value)} />
                    </Field>
                    <Field label="Headline" hint="Shown above the timer">
                      <StyledInput placeholder="Launching soon…" value={countdownTitle} onChange={e => setCountdownTitle(e.target.value)} />
                    </Field>
                  </div>
                  <Field label="Supporting Description">
                    <StyledInput placeholder="Something big is coming. Stay tuned." value={countdownDesc} onChange={e => setCountdownDesc(e.target.value)} />
                  </Field>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Request Access page text — shown on the public Request Access page when site is disabled */}
          <div style={{ paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Divider label="Request Access Page" />
            <InfoBanner icon={Info} variant="info">
              These texts appear on the public Request Access page while the site is in maintenance mode.
            </InfoBanner>
            <Field label="Page Title" hint="Headline shown above the request form">
              <StyledInput
                placeholder="Request Access"
                value={disabledTitle}
                onChange={e => setDisabledTitle(e.target.value)}
              />
            </Field>
            <Field label="Page Description" hint="The message visitors see when the site is down. Saved here and shown verbatim.">
              <StyledTextarea
                rows={3}
                placeholder="The website is currently undergoing maintenance. Fill out the form below to request access."
                value={disabledMsg}
                onChange={e => setDisabledMsg(e.target.value)}
              />
            </Field>
            {(disabledTitle || disabledMsg) && (
              <div style={{
                padding: '14px 16px', borderRadius: 12,
                background: 'rgba(56,189,248,0.05)',
                border: `1px solid ${C.skyBorder}`,
              }}>
                <p style={{ margin: '0 0 4px', fontSize: 10.5, color: 'rgba(56,189,248,0.6)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>Preview</p>
                <p style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800, color: C.text, lineHeight: 1.3 }}>{disabledTitle || 'Request Access'}</p>
                {disabledMsg && <p style={{ margin: 0, fontSize: 12.5, color: C.textMid, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{disabledMsg}</p>}
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Home Page Theme */}
      <Card glow={summerThemeEnabled ? '#fb923c' : undefined}>
        <CardHeader
          icon={Sun}
          color={summerThemeEnabled ? '#fb923c' : C.textMid}
          title="Home Page Theme"
          desc="Switch the home page between the default look and a tropical summer theme"
          badge={summerThemeEnabled ? '☀️ Summer' : 'Default'}
          badgeVariant={summerThemeEnabled ? 'warning' : 'info'}
        />
        <CardBody>
          <Toggle
            checked={summerThemeEnabled}
            onChange={handleSummerToggle}
            label="Summer Theme"
            desc="Applies a warm sunset gradient, palm frond decorations and beach accents to the home page hero. Saves instantly — no need to click Save Changes."
          />
          {summerThemeEnabled && (
            <div style={{
              marginTop: 14,
              padding: '12px 16px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(253,186,116,0.12), rgba(56,189,248,0.10))',
              border: '1px solid rgba(251,146,60,0.30)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}>
              <div style={{ fontSize: 28, lineHeight: 1 }}>🌴</div>
              <div>
                <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#fb923c' }}>Summer theme is active</p>
                <p style={{ margin: '2px 0 0', fontSize: 11.5, color: C.textMid, lineHeight: 1.5 }}>
                  The home page will show a tropical sunset gradient with palm fronds. Save to publish.
                </p>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Weather Phase Text */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        {/* Storm */}
        <Card>
          <CardHeader icon={CloudRain} color="#818cf8" title="Storm Phase Text" desc="Content displayed during storm / TCM mode" badge="⛈ Thunder" badgeVariant="violet" />
          <CardBody>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Headline">
                <StyledInput placeholder="TCM Storm Centre" value={stormTitle} onChange={e => setStormTitle(e.target.value)} />
              </Field>
              <Field label="Description">
                <StyledTextarea rows={2} placeholder="Professional storm chasing and severe weather tracking across the UK." value={stormMsg} onChange={e => setStormMsg(e.target.value)} />
              </Field>
              {(stormTitle || stormMsg) && (
                <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(129,140,248,0.06)', border: '1px solid rgba(129,140,248,0.15)' }}>
                  <p style={{ margin: '0 0 2px', fontSize: 10, color: 'rgba(129,140,248,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>Preview</p>
                  <p style={{ margin: '0 0 4px', fontSize: 13.5, fontWeight: 700, color: C.text }}>{stormTitle || 'TCM Storm Centre'}</p>
                  <p style={{ margin: 0, fontSize: 12, color: C.textMid, lineHeight: 1.6 }}>{stormMsg || 'Description…'}</p>
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Sunny */}
        <Card>
          <CardHeader icon={Sun} color={C.amber} title="Sunny Phase Text" desc="Content displayed during clear / sunny weather mode" badge="☀ Clear" badgeVariant="warning" />
          <CardBody>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Headline">
                <StyledInput placeholder="MyWeatherUK" value={sunnyTitle} onChange={e => setSunnyTitle(e.target.value)} />
              </Field>
              <Field label="Description">
                <StyledTextarea rows={2} placeholder="Your trusted source for UK weather forecasts and alerts." value={sunnyMsg} onChange={e => setSunnyMsg(e.target.value)} />
              </Field>
              {(sunnyTitle || sunnyMsg) && (
                <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)' }}>
                  <p style={{ margin: '0 0 2px', fontSize: 10, color: 'rgba(251,191,36,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>Preview</p>
                  <p style={{ margin: '0 0 4px', fontSize: 13.5, fontWeight: 700, color: C.text }}>{sunnyTitle || 'MyWeatherUK'}</p>
                  <p style={{ margin: 0, fontSize: 12, color: C.textMid, lineHeight: 1.6 }}>{sunnyMsg || 'Description…'}</p>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Cycle Info */}
      <Card>
        <CardHeader icon={Clock} color={C.textMid} title="Weather Cycle" desc="Automatic phase durations — read only" />
        <CardBody style={{ paddingTop: 16, paddingBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
            {PHASES.map(({ label, dur, color, bg }) => (
              <div key={label} style={{ padding: '12px 14px', borderRadius: 12, background: bg, border: `1px solid ${color}20`, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color }}>{label}</p>
                <p style={{ margin: 0, fontSize: 10.5, color: C.textFaint, letterSpacing: '0.04em' }}>{dur} · auto</p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <SaveButton loading={saving} />
      </div>
    </form>
  );
}

// ─── News Tab — full article manager + landing page toggle ────────────────────
/* These MUST be the NewsArticle schema's category enum, and the colours must be
   the ones the public News page uses.

   They were neither. The editor offered announcement / update / alert / feature
   while the entity only accepts Analysis / Storm / Climate / Forecast / Update,
   so every article saved from here carried a category the schema rejects and the
   public page cannot colour. It also worked in reverse: opening a correctly
   categorised article found no matching id, fell back to the first entry, and
   silently rewrote a valid "Climate" story as "announcement" on save. */
const NEWS_CATS = [
  { id: 'Analysis', label: 'Analysis', color: '#38bdf8' },
  { id: 'Storm',    label: 'Storm',    color: '#f87171' },
  { id: 'Climate',  label: 'Climate',  color: '#34d399' },
  { id: 'Forecast', label: 'Forecast', color: '#a78bfa' },
  { id: 'Update',   label: 'Update',   color: '#fbbf24' },
];
const BLANK_ARTICLE = { title: '', body: '', category: 'Analysis', link_url: '', link_label: '', image_url: '', published: true };

function NewsArticleForm({ initial = BLANK_ARTICLE, onSave, onCancel, saving }) {
  /* Null-stripped before merging. A plain spread lets a stored null OVERWRITE
     the blank's empty string — spread copies nulls, it does not skip them — and
     an article whose optional fields were never set then put null into a text
     input and, worse, into the .trim() calls in the save handler. That threw a
     TypeError which the handler's bare catch reported as "Failed to save
     article", with nothing to say which field or why. */
  const clean = Object.fromEntries(
    Object.entries(initial || {}).filter(([, v]) => v !== null && v !== undefined)
  );
  const [form, setForm] = useState({ ...BLANK_ARTICLE, ...clean });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const cat = NEWS_CATS.find(c => c.id === form.category) || NEWS_CATS[0];
  const [imgBusy, setImgBusy] = useState(false);
  const [imgCaption, setImgCaption] = useState('');

  /* Upload a picture and drop an [[img:...]] marker into the body. Typing a URL
     by hand was the only route before, which meant an image had to be hosted
     somewhere else first — the reason the first article rendered broken
     placeholders. The marker is appended at the end; move it to wherever it
     belongs in the text. */
  const insertImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImgBusy(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const marker = `[[img:${file_url}${imgCaption.trim() ? `|${imgCaption.trim()}` : ''}]]`;
      setForm(p => ({ ...p, body: p.body ? `${p.body.trimEnd()}\n\n${marker}\n\n` : `${marker}\n\n` }));
      setImgCaption('');
      toast.success('Image added to the article body');
    } catch {
      toast.error('Upload failed');
    } finally {
      setImgBusy(false);
      e.target.value = '';    // let the same file be picked again
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="Category">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {NEWS_CATS.map(c => (
            <button key={c.id} type="button" onClick={() => set('category', c.id)}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: `1.5px solid ${form.category === c.id ? c.color : C.border2}`,
                background: form.category === c.id ? `${c.color}18` : 'transparent',
                color: form.category === c.id ? c.color : C.textMid, fontFamily: FONT,
              }}>{c.label}</button>
          ))}
        </div>
      </Field>

      <Field label="Headline" hint="Shown as the large article title on the News page.">
        <StyledInput placeholder="e.g. Severe storms expected this weekend"
          value={form.title} onChange={e => set('title', e.target.value)} maxLength={140} />
      </Field>

      <Field label="Body" hint="Blank line = new paragraph. **Wrapped in stars** on its own line = section heading. Lines starting with '- ' = bullet list.">
        <StyledTextarea rows={12} placeholder="Write the article body here…"
          value={form.body} onChange={e => set('body', e.target.value)} />
      </Field>

      <Field label="Add a picture into the article"
        hint="Uploads the file and inserts it at the end of the body as [[img:…]]. Cut and paste that line to wherever you want the picture to appear.">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <StyledInput placeholder="Caption (optional)" value={imgCaption}
            onChange={e => setImgCaption(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9,
            fontSize: 12.5, fontWeight: 700, cursor: imgBusy ? 'wait' : 'pointer', fontFamily: FONT,
            background: C.skyLow, border: `1px solid ${C.skyBorder}`, color: C.sky, whiteSpace: 'nowrap',
          }}>
            {imgBusy
              ? <Loader2 style={{ width: 14, height: 14, animation: 'spin 0.8s linear infinite' }} />
              : <Upload style={{ width: 14, height: 14 }} />}
            {imgBusy ? 'Uploading…' : 'Upload picture'}
            <input type="file" accept="image/*" onChange={insertImage} disabled={imgBusy}
              style={{ display: 'none' }} />
          </label>
        </div>
      </Field>

      <Field label="Cover image URL (optional)" hint="A full https:// URL to an image. Leave blank for a category icon placeholder.">
        <StyledInput placeholder="https://images.example.com/storm.jpg"
          value={form.image_url} onChange={e => set('image_url', e.target.value)} />
      </Field>

      <Divider label="Call-to-action link (optional)" />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <Field label="Link URL"><StyledInput placeholder="https://…" value={form.link_url} onChange={e => set('link_url', e.target.value)} /></Field>
        <Field label="Link Label"><StyledInput placeholder="Read more" value={form.link_label} onChange={e => set('link_label', e.target.value)} /></Field>
      </div>

      <Toggle checked={form.published} onChange={v => set('published', v)}
        label="Published" desc="Tick to make this article visible on the News page immediately." />

      {/* Mini preview */}
      {form.title.trim() && (
        <div style={{ padding: '14px 16px', borderRadius: 12, background: `${cat.color}0d`, border: `1px solid ${cat.color}30` }}>
          <p style={{ margin: '0 0 4px', fontSize: 10, color: cat.color, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Preview — {cat.label}</p>
          <p style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 800, color: C.text, lineHeight: 1.2, textTransform: 'uppercase', fontFamily: "'Bebas Neue',impact,sans-serif", letterSpacing: '0.03em' }}>{form.title}</p>
          {form.body && <p style={{ margin: 0, fontSize: 13, color: C.textMid, lineHeight: 1.6 }}>{form.body}</p>}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
        <button type="button" onClick={onCancel}
          style={{ padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'transparent', border: `1px solid ${C.border2}`, color: C.textMid, fontFamily: FONT }}>
          Cancel
        </button>
        <button type="button" onClick={() => onSave(form)} disabled={saving || !form.title.trim()}
          style={{
            padding: '9px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: saving || !form.title.trim() ? 'not-allowed' : 'pointer', fontFamily: FONT,
            background: form.published ? 'linear-gradient(135deg, #0ea5e9, #0284c7)' : C.surface3,
            border: 'none', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 7, opacity: !form.title.trim() ? 0.5 : 1,
          }}>
          {saving ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 0.8s linear infinite' }} /> : <Save style={{ width: 13, height: 13 }} />}
          {form.published ? 'Publish' : 'Save as Draft'}
        </button>
      </div>
    </div>
  );
}

function NewsTab() {
  const queryClient = useQueryClient();

  // ── SiteSettings (for landing page toggle) ──
  const { data: siteSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => { const list = await base44.entities.SiteSettings.list(); return list[0] || null; },
  });

  // ── NewsArticle CRUD — safe fallback if entity doesn't exist yet ──
  const { data: articles = [], isLoading } = useQuery({
    queryKey: ['admin-news-articles'],
    queryFn: async () => {
      try { return await base44.entities.NewsArticle.list('-published_at'); }
      catch { return []; }
    },
  });

  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState(null);
  const [saving, setSaving]       = useState(false);
  const [landingSaving, setLandingSaving] = useState(false);
  // Optimistic local state so the UI updates instantly on click
  const [localLanding, setLocalLanding] = useState(null);

  const currentLanding = localLanding ?? siteSettings?.landing_page ?? 'Home';

  const handleSaveLanding = async (page) => {
    setLocalLanding(page); // instant UI feedback
    setLandingSaving(true);
    try {
      if (siteSettings?.id) await base44.entities.SiteSettings.update(siteSettings.id, { landing_page: page });
      else await base44.entities.SiteSettings.create({ site_name: 'MyWeatherUK', landing_page: page });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success(`Landing page set to "${page}"`);
    } catch {
      setLocalLanding(null); // revert on error
      toast.error('Failed to update landing page');
    }
    setLandingSaving(false);
  };

  const handleSaveArticle = async (form) => {
    setSaving(true);
    try {
      // Coerced before trimming: any of these can arrive null from a record
      // created outside this form, and null.trim() is a TypeError.
      const text = (v) => String(v ?? '').trim();
      const payload = {
        title:       text(form.title),
        body:        text(form.body),
        category:    form.category,
        link_url:    text(form.link_url),
        link_label:  text(form.link_label),
        image_url:   text(form.image_url),
        published:   !!form.published,
        published_at: editing ? (editing.published_at || new Date().toISOString()) : new Date().toISOString(),
      };
      if (editing) {
        await base44.entities.NewsArticle.update(editing.id, payload);
        toast.success('Article updated');
      } else {
        await base44.entities.NewsArticle.create(payload);
        toast.success('Article published');
      }
      queryClient.invalidateQueries({ queryKey: ['admin-news-articles'] });
      setShowForm(false); setEditing(null);
    } catch (err) {
      // The reason, not just the fact. A bare "Failed to save article" hid a
      // TypeError in this handler for as long as it existed.
      console.error('[news] save failed:', err);
      toast.error(`Failed to save article: ${err?.message || 'unknown error'}`);
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this article permanently?')) return;
    try {
      await base44.entities.NewsArticle.delete(id);
      queryClient.invalidateQueries({ queryKey: ['admin-news-articles'] });
      toast.success('Article deleted');
    } catch { toast.error('Failed to delete'); }
  };

  const handleTogglePublish = async (article) => {
    try {
      await base44.entities.NewsArticle.update(article.id, { published: !article.published });
      queryClient.invalidateQueries({ queryKey: ['admin-news-articles'] });
      toast.success(article.published ? 'Article unpublished' : 'Article published');
    } catch { toast.error('Failed to update'); }
  };

  const LANDING_OPTIONS = [
    { id: 'Home',  label: 'Home Page',  desc: 'Weather dashboard & warnings', color: C.sky },
    { id: 'News',  label: 'News Page',  desc: 'Full editorial news hub',       color: '#34d399' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Landing page selector ── */}
      <Card glow="#a78bfa">
        <CardHeader icon={Home} color="#a78bfa" title="Default Landing Page"
          desc="Choose which page users see first when they visit the site root (/)."
          badge={currentLanding === 'News' ? 'NEWS' : 'HOME'} badgeVariant="info" />
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {LANDING_OPTIONS.map(opt => {
              const active = currentLanding === opt.id;
              return (
                <button key={opt.id} type="button"
                  onClick={() => !active && handleSaveLanding(opt.id)}
                  disabled={landingSaving}
                  style={{
                    padding: '16px 18px', borderRadius: 12, cursor: active ? 'default' : 'pointer',
                    border: `1.5px solid ${active ? opt.color : C.border2}`,
                    background: active ? `${opt.color}12` : C.surface3,
                    textAlign: 'left', fontFamily: FONT, transition: 'all 0.18s',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 800, color: active ? opt.color : C.text }}>{opt.label}</span>
                    {active && <Check style={{ width: 14, height: 14, color: opt.color }} />}
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: C.textMid }}>{opt.desc}</p>
                </button>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* ── Article manager ── */}
      <Card glow="#34d399">
        <CardHeader icon={Newspaper} color="#34d399" title="News Articles"
          desc={`${articles.filter(a => a.published).length} published · ${articles.filter(a => !a.published).length} draft`}
          actions={
            !showForm ? (
              <button type="button" onClick={() => { setEditing(null); setShowForm(true); }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#34d399', border: 'none', borderRadius: 8, color: '#050a14', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                <Plus style={{ width: 13, height: 13 }} /> New Article
              </button>
            ) : null
          }
        />
        <CardBody>
          {showForm ? (
            <NewsArticleForm
              initial={editing || BLANK_ARTICLE}
              onSave={handleSaveArticle}
              onCancel={() => { setShowForm(false); setEditing(null); }}
              saving={saving}
            />
          ) : isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0', color: C.textMid, fontSize: 13 }}>
              <Loader2 style={{ width: 16, height: 16, animation: 'spin 0.8s linear infinite' }} /> Loading articles…
            </div>
          ) : articles.length === 0 ? (
            <div style={{ padding: '28px 0', textAlign: 'center', color: C.textMid, fontSize: 13 }}>
              No articles yet. Click <strong style={{ color: '#34d399' }}>New Article</strong> to create your first.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {articles.map(a => {
                const cat = NEWS_CATS.find(c => c.id === a.category) || NEWS_CATS[0];
                const pub = a.published_at ? new Date(a.published_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
                return (
                  <div key={a.id} style={{
                    padding: '14px 16px', borderRadius: 12, display: 'flex', alignItems: 'flex-start', gap: 14,
                    background: C.surface3, border: `1px solid ${a.published ? cat.color + '22' : C.border}`,
                    transition: 'border-color 0.18s',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 3, background: cat.color + '20', color: cat.color, fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{cat.label}</span>
                        <span style={{ padding: '2px 8px', borderRadius: 3, background: a.published ? 'rgba(74,222,128,0.15)' : C.surface, color: a.published ? '#4ade80' : '#64748b', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                          {a.published ? 'Live' : 'Draft'}
                        </span>
                        {pub && <span style={{ fontSize: 11, color: C.textDim, fontFamily: "'DM Mono',monospace" }}>{pub}</span>}
                      </div>
                      <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{a.title}</p>
                      {a.body && <p style={{ margin: 0, fontSize: 12, color: C.textMid, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{a.body}</p>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <IconBtn icon={a.published ? Eye : EyeOff} onClick={() => handleTogglePublish(a)}
                        title={a.published ? 'Unpublish' : 'Publish'} color={a.published ? '#4ade80' : C.textMid} />
                      <IconBtn icon={Edit} onClick={() => { setEditing(a); setShowForm(true); }}
                        title="Edit" color={C.sky} />
                      <IconBtn icon={Trash2} onClick={() => handleDelete(a.id)}
                        title="Delete" danger />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Wrappers around imported admin components for visual consistency ─────────────
// ─── Announcements & Updates ──────────────────────────────────────────────────
// One tab, two sections. They used to be separate tabs and were routinely
// mistaken for each other: both post something site-wide, both are dated, both
// are written the same way, and the only real difference is what they are FOR —
// an announcement is a notice that something is happening, an update is a
// changelog entry recording that something changed. Sitting them next to each
// other makes that distinction visible instead of asking you to remember which
// tab you wanted before you have decided what you are writing.
function NoticesTab() {
  const [sub, setSub] = useState('announce');
  const SUBS = [
    { id: 'announce', label: 'Announcements', icon: Megaphone, color: C.sky,
      desc: 'Site-wide notices — shown in the banner at the top of every page.' },
    { id: 'updates',  label: 'Updates',       icon: History,   color: C.violet,
      desc: 'Changelog entries and release notes — what changed, and when.' },
  ];
  const cur = SUBS.find(s => s.id === sub) || SUBS[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{
        padding: '18px 20px', borderRadius: 18,
        background: 'linear-gradient(155deg, rgba(56,189,248,0.05) 0%, rgba(167,139,250,0.04) 100%)',
        border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 220, flex: 1 }}>
          <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.sky }}>
            Announcements &amp; Updates
          </p>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>{cur.label}</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: C.textMid, lineHeight: 1.5, maxWidth: 420 }}>{cur.desc}</p>
        </div>

        <div style={{ display: 'flex', gap: 10, marginLeft: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {SUBS.map(s => {
            const on = sub === s.id;
            const SIcon = s.icon;
            return (
              <button key={s.id} type="button" onClick={() => setSub(s.id)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                width: 108, padding: '16px 10px', borderRadius: 14,
                cursor: 'pointer', fontFamily: FONT, transition: 'all 0.2s',
                background: on ? `${s.color}10` : 'rgba(148,163,184,0.04)',
                border: `1.5px solid ${on ? s.color + '40' : 'rgba(148,163,184,0.12)'}`,
                boxShadow: on ? `0 0 20px ${s.color}08` : 'none',
              }}
              onMouseEnter={e => { if (!on) e.currentTarget.style.borderColor = s.color + '30'; e.currentTarget.style.background = s.color + '08'; }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)'; e.currentTarget.style.background = 'rgba(148,163,184,0.04)'; }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: on ? `${s.color}18` : 'rgba(148,163,184,0.06)',
                  border: `1px solid ${on ? s.color + '35' : 'rgba(148,163,184,0.1)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.2s',
                }}>
                  <SIcon style={{ width: 19, height: 19, color: on ? s.color : C.textFaint, transition: 'color 0.2s' }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: on ? s.color : C.textMid, textAlign: 'center', lineHeight: 1.3 }}>{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {sub === 'announce' ? <AnnouncementsAdmin /> : <UpdatesTab />}
    </div>
  );
}

function AdminWrap({ children }) {
  return <div className="admin-tab-wrap">{children}</div>;
}

/* ─── Map Drawing ──────────────────────────────────────────────────
   Hand-drawn charts, as opposed to the data-driven graphics elsewhere in the
   studio. Two tools that share a coastline layer and a set of drawing
   primitives (lib/synopticGeo.js, components/synoptic/synopticDraw.jsx):

     Synoptic Chart  fronts, isobars, the jet, pressure centres.
     Weather Types   coloured areas clipped to land, with a key.

   They are one section rather than two top-level entries because they are the
   same job at different levels of detail, and an admin drawing one very often
   wants the other for the same forecast.                                     */
function MapDrawingSection({ logoUrl }) {
  const [sub, setSub] = useState('synoptic');
  const TOOLS = [
    { id: 'synoptic', label: 'Synoptic Chart', icon: Wind,    color: '#5b6ee8', desc: 'Fronts, isobars, jet stream & pressure centres' },
    { id: 'wxtypes',  label: 'Weather Types',  icon: MapIcon, color: '#c8e619', desc: 'Draw weather-type areas with a key & likelihood' },
  ];
  const cur = TOOLS.find(t => t.id === sub);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {TOOLS.map(t => {
          const on = sub === t.id;
          const TIcon = t.icon;
          return (
            <button key={t.id} type="button" onClick={() => setSub(t.id)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 12,
              cursor: 'pointer', fontFamily: FONT, transition: 'all 0.2s',
              background: on ? `${t.color}12` : 'rgba(148,163,184,0.04)',
              border: `1.5px solid ${on ? t.color + '55' : 'rgba(148,163,184,0.12)'}`,
            }}>
              <TIcon style={{ width: 17, height: 17, color: on ? t.color : C.textFaint }} />
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: on ? t.color : C.textMid }}>{t.label}</span>
                <span style={{ fontSize: 10.5, color: C.textFaint }}>{t.desc}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ borderRadius: 14, border: `1px solid ${cur.color}25`, overflow: 'hidden' }}>
        <div style={{ padding: '18px 16px', background: 'rgba(8,12,22,0.5)' }}>
          {sub === 'synoptic'
            ? <SynopticChartTool siteLogoUrl={logoUrl} />
            : <WeatherTypeMapTool siteLogoUrl={logoUrl} />}
        </div>
      </div>
    </div>
  );
}

// ─── Storm Graphic Tab — sub-tabs for Outlook vs Traffic Light vs Temp ──────
function StormGraphicTab({ logoUrl }) {
  const [sub, setSub] = useState('outlook');
  // Likelihood Card and Scenario Forecast moved to the "Past & Future
  // Conditions" section — they answer "what might happen", not "what is the
  // storm doing now", which is what this studio is for.
  const SUBS = [
    { id: 'outlook',  label: 'Thunderstorm Outlook', icon: CloudLightning, color: '#facc15', desc: 'Full risk map with timeline & drawing' },
    { id: 'snow',     label: 'Snow Chance',          icon: Snowflake,      color: '#7dd3fc', desc: 'Snow chance map with timeline, drawing & model snowfall' },
    { id: 'snowacc',  label: 'Snow Accumulation',    icon: Layers,         color: '#93c5fd', desc: 'Snow depth (cm) map with timeline & drawing' },
    { id: 'snowrisk', label: 'Snow Risk',            icon: CloudSnow,      color: '#a78bfa', desc: 'Snow disruption risk map with timeline & drawing' },
    { id: 'wind',     label: 'Wind',                 icon: WindIcon,       color: '#fb923c', desc: 'Gust map (mph) with timeline & drawing' },
    { id: 'temp',     label: 'Temperature Map',      icon: Thermometer,    color: '#f59e0b', desc: 'Live UK temperature surface' },
    { id: 'mapdraw',  label: 'Map Drawing',          icon: Pen,            color: '#5b6ee8', desc: 'Synoptic charts & weather-type areas' },
    { id: 'pastfut',  label: 'Past & Future',        icon: History,        color: '#22d3ee', desc: 'Climate anomalies, likelihood & scenarios' },
    { id: 'eclipse',  label: 'Solar Eclipse',        icon: Sun,            color: '#f0abfc', desc: 'Coverage map with per-location times & weather symbols' },
  ];
  const cur = SUBS.find(s => s.id === sub);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Hero banner */}
      <div style={{
        padding: '22px 26px', borderRadius: 18,
        background: 'linear-gradient(155deg, rgba(236,72,153,0.06) 0%, rgba(56,189,248,0.04) 100%)',
        border: `1px solid ${C.border}`, overflow: 'hidden', position: 'relative',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(236,72,153,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 48 }}>
          <div>
            <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#ec4899' }}>Graphic Studio</p>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>Graphic Studio</h2>
            <p style={{ margin: '6px 0 0', fontSize: 12.5, color: C.textMid, lineHeight: 1.5, maxWidth: 440 }}>
              Professional broadcast-quality social graphics for thunderstorm and snow outlooks and live temperature maps. Drag, draw, and export.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, marginLeft: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {SUBS.map(s => {
              const on = sub === s.id;
              const SIcon = s.icon;
              return (
                <button key={s.id} type="button" onClick={() => setSub(s.id)} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                  width: 108, padding: '16px 10px', borderRadius: 14,
                  cursor: 'pointer', fontFamily: FONT, transition: 'all 0.2s',
                  background: on ? `${s.color}10` : 'rgba(148,163,184,0.04)',
                  border: `1.5px solid ${on ? s.color + '40' : 'rgba(148,163,184,0.12)'}`,
                  boxShadow: on ? `0 0 20px ${s.color}08` : 'none',
                }}
                onMouseEnter={e => { if (!on) e.currentTarget.style.borderColor = s.color + '30'; e.currentTarget.style.background = s.color + '08'; }}
                onMouseLeave={e => { if (!on) e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)'; e.currentTarget.style.background = 'rgba(148,163,184,0.04)'; }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: on ? `${s.color}18` : 'rgba(148,163,184,0.06)',
                    border: `1px solid ${on ? s.color + '35' : 'rgba(148,163,184,0.1)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.2s',
                  }}>
                    <SIcon style={{ width: 19, height: 19, color: on ? s.color : C.textFaint, transition: 'color 0.2s' }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: on ? s.color : C.textMid, textAlign: 'center', lineHeight: 1.3 }}>{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Active tool card */}
      <div style={{
        borderRadius: 18, overflow: 'hidden',
        border: `1px solid ${cur.color}25`,
        boxShadow: `0 0 0 1px ${cur.color}08, 0 8px 32px rgba(0,0,0,0.25)`,
      }}>
        <div style={{
          padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10,
          background: `${cur.color}0d`, borderBottom: `1px solid ${cur.color}18`,
        }}>
          <cur.icon style={{ width: 15, height: 15, color: cur.color }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: cur.color, letterSpacing: '0.04em' }}>{cur.label}</span>
          <span style={{ fontSize: 11, color: C.textFaint }}>— {cur.desc}</span>
        </div>
        <div style={{ background: C.bgAlt, padding: '22px 20px' }}>
          {sub === 'outlook' && <StormOutlookGraphicTool myWeatherLogoUrl={logoUrl} />}
          {sub === 'snow'     && <SnowOutlookGraphicTool key="chance" variant="chance" myWeatherLogoUrl={logoUrl} />}
          {sub === 'snowacc'  && <SnowOutlookGraphicTool key="accumulation" variant="accumulation" myWeatherLogoUrl={logoUrl} />}
          {sub === 'snowrisk' && <SnowOutlookGraphicTool key="risk" variant="risk" myWeatherLogoUrl={logoUrl} />}
          {sub === 'wind'     && <SnowOutlookGraphicTool key="wind" variant="wind" myWeatherLogoUrl={logoUrl} />}
          {sub === 'temp'    && <TemperatureMapTool />}
          {sub === 'mapdraw' && <MapDrawingSection logoUrl={logoUrl} />}
          {/* Nested, so it keeps its own three tools but drops the hero banner
              — two stacked heroes read as two pages, not one section. */}
          {sub === 'pastfut' && <PastFutureTab logoUrl={logoUrl} nested />}
          {sub === 'eclipse' && <SolarEclipseGraphicTool />}
        </div>
      </div>
    </div>
  );
}

// ─── Past & Future Conditions ────────────────────────────────────────
// Everything that looks BACK at how a month actually turned out, or FORWARD at
// how a period might turn out — as opposed to the Graphic Studio, which covers
// the live/imminent situation.
function PastFutureTab({ logoUrl, nested = false }) {
  const [sub, setSub] = useState('climate');
  const SUBS = [
    { id: 'climate',  label: 'Monthly Climate',   icon: CloudRain, color: '#22d3ee', desc: 'Rainfall, temp, sun & cloud vs the 1991–2020 average' },
    { id: 'traffic',  label: 'Likelihood Card',   icon: Activity,  color: '#38bdf8', desc: 'Traffic-light risk tiers for social' },
    { id: 'scenario', label: 'Scenario Forecast', icon: Layers,    color: '#34d399', desc: '3-way synoptic scenario board' },
  ];
  const cur = SUBS.find(s => s.id === sub);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Hero banner */}
      <div style={{
        padding: '22px 26px', borderRadius: 18,
        background: 'linear-gradient(155deg, rgba(34,211,238,0.06) 0%, rgba(52,211,153,0.04) 100%)',
        border: `1px solid ${C.border}`, overflow: 'hidden', position: 'relative',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(34,211,238,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 48 }}>
          {/* Suppressed when nested inside Graphic Studio: that page already
              carries a hero, and two stacked ones read as two separate pages. */}
          {!nested && (
            <div>
              <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#22d3ee' }}>Climate &amp; Outlook</p>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>Past &amp; Future Conditions</h2>
              <p style={{ margin: '6px 0 0', fontSize: 12.5, color: C.textMid, lineHeight: 1.5, maxWidth: 440 }}>
                How a month actually turned out against the long-term average, and how the coming period might play out — monthly climate anomalies, likelihood cards and synoptic scenarios.
              </p>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginLeft: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {SUBS.map(s => {
              const on = sub === s.id;
              const SIcon = s.icon;
              return (
                <button key={s.id} type="button" onClick={() => setSub(s.id)} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                  width: 108, padding: '16px 10px', borderRadius: 14,
                  cursor: 'pointer', fontFamily: FONT, transition: 'all 0.2s',
                  background: on ? `${s.color}10` : 'rgba(148,163,184,0.04)',
                  border: `1.5px solid ${on ? s.color + '40' : 'rgba(148,163,184,0.12)'}`,
                  boxShadow: on ? `0 0 20px ${s.color}08` : 'none',
                }}
                onMouseEnter={e => { if (!on) e.currentTarget.style.borderColor = s.color + '30'; e.currentTarget.style.background = s.color + '08'; }}
                onMouseLeave={e => { if (!on) e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)'; e.currentTarget.style.background = 'rgba(148,163,184,0.04)'; }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: on ? `${s.color}18` : 'rgba(148,163,184,0.06)',
                    border: `1px solid ${on ? s.color + '35' : 'rgba(148,163,184,0.1)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.2s',
                  }}>
                    <SIcon style={{ width: 19, height: 19, color: on ? s.color : C.textFaint, transition: 'color 0.2s' }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: on ? s.color : C.textMid, textAlign: 'center', lineHeight: 1.3 }}>{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Active tool card */}
      <div style={{
        borderRadius: 18, overflow: 'hidden',
        border: `1px solid ${cur.color}25`,
        boxShadow: `0 0 0 1px ${cur.color}08, 0 8px 32px rgba(0,0,0,0.25)`,
      }}>
        <div style={{
          padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10,
          background: `${cur.color}0d`, borderBottom: `1px solid ${cur.color}18`,
        }}>
          <cur.icon style={{ width: 15, height: 15, color: cur.color }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: cur.color, letterSpacing: '0.04em' }}>{cur.label}</span>
          <span style={{ fontSize: 11, color: C.textFaint }}>— {cur.desc}</span>
        </div>
        <div style={{ background: C.bgAlt, padding: '22px 20px' }}>
          {sub === 'climate'
            ? <ClimateAnomalyGraphicTool siteLogoUrl={logoUrl} />
            : sub === 'traffic'
            ? <TrafficLightGraphicTool siteLogoUrl={logoUrl} />
            : <ScenarioForecastTool siteLogoUrl={logoUrl} />}
        </div>
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────────
export default function AdminSettings() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('general');
  const [formData, setFormData] = useState({
    site_name: '', description: '', logo_url: '', banner_url: '', version: '',
    twitter_url: '', facebook_url: '', instagram_url: '', youtube_url: '', discord_url: '', buymeacoffee_url: '',
  });
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  /* The data URL of a logo waiting to be cropped. Held here rather than in the
     slot so the cropper can be a full-screen overlay. */
  const [logoCrop, setLogoCrop] = useState(null);
  const [previewAnimTier, setPreviewAnimTier] = useState(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  // NOTE: refetchInterval is intentionally OFF here. Admin auto-refresh was removed
  // per request — admins refresh by pressing the explicit Refresh button only.
  const { data: existingSettings, isLoading, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => { const list = await base44.entities.SiteSettings.list(); return list[0] || null; },
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    refetchInterval: false,
    staleTime: Infinity,
  });

  const handleManualRefresh = async () => {
    setManualRefreshing(true);
    try {
      await queryClient.invalidateQueries();
      await refetch();
      toast.success('Refreshed');
    } catch { toast.error('Refresh failed'); }
    finally { setManualRefreshing(false); }
  };

  useEffect(() => {
    if (!existingSettings) return;
    setFormData({
      site_name: existingSettings.site_name || '',
      description: existingSettings.description || '',
      logo_url: existingSettings.logo_url || '',
      banner_url: existingSettings.banner_url || '',
      version: existingSettings.version || '',
      twitter_url: existingSettings.twitter_url || '',
      facebook_url: existingSettings.facebook_url || '',
      instagram_url: existingSettings.instagram_url || '',
      youtube_url: existingSettings.youtube_url || '',
      discord_url: existingSettings.discord_url || '',
      buymeacoffee_url: existingSettings.buymeacoffee_url || '',
    });
  }, [existingSettings]);

  const saveMutation = useMutation({
    mutationFn: async (data) =>
      existingSettings
        ? base44.entities.SiteSettings.update(existingSettings.id, data)
        : base44.entities.SiteSettings.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['settings'] }); toast.success('Settings saved successfully'); },
    onError: () => toast.error('Failed to save settings'),
  });

  const handleImageUpload = async (e, type) => {
    const file = e.target.files[0]; if (!file) return;

    /* The logo goes through the circle cropper first — what is uploaded is the
       cut version, so what everyone sees is what was chosen here. Clearing the
       input means picking the same file twice still reopens the cropper. */
    if (type === 'logo') {
      const reader = new FileReader();
      reader.onload = () => setLogoCrop(String(reader.result));
      reader.onerror = () => toast.error('That file could not be read');
      reader.readAsDataURL(file);
      e.target.value = '';
      return;
    }

    setUploadingBanner(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setFormData(prev => ({ ...prev, banner_url: file_url }));
    } finally {
      setUploadingBanner(false);
    }
  };

  /* The cropper hands back a circular PNG; this puts it where the banner path
     puts its file. Still needs Save, like every other field on this form. */
  const handleCroppedLogo = async (file) => {
    setUploadingLogo(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setFormData(prev => ({ ...prev, logo_url: file_url }));
      setLogoCrop(null);
      toast.success('Logo cropped — press Save to publish it');
    } catch {
      toast.error('The cropped logo could not be uploaded');
    } finally {
      setUploadingLogo(false);
    }
  };

  // All admin tabs are now wired to real components. Site/General use inline forms.
  const tabContent = {
    general:  <GeneralTab formData={formData} setFormData={setFormData} saveMutation={saveMutation} handleImageUpload={handleImageUpload} uploadingLogo={uploadingLogo} uploadingBanner={uploadingBanner} setPreviewAnimTier={setPreviewAnimTier} />,
    site:     <SiteControlTab />,
    news:     <NewsTab />,
    subscriptions: <AdminWrap><SubscriptionMatrixAdmin /></AdminWrap>,
    warnings: <AdminWrap><ManualWarningsAdmin /></AdminWrap>,
    announce: <AdminWrap><NoticesTab /></AdminWrap>,
    'storm-graphic': <AdminWrap><StormGraphicTab logoUrl={formData.logo_url} /></AdminWrap>,
    tcm:      <AdminWrap><div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}><OMDataSourcePanel /><TCMCalibrationLab /><RelayStatusPanel /><TCMAdmin /></div></AdminWrap>,
    newsletter: <AdminWrap><NewsletterAdmin /></AdminWrap>,
    source:   <AdminWrap><SourceFilesDownloader /></AdminWrap>,
    access:   <AdminWrap>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <InvitationLinkGenerator />
                  <AccessRequestPanel />
                </div>
              </AdminWrap>,
  };

  if (isLoading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, fontFamily: FONT }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 52, height: 52, borderRadius: 16, background: C.skyLow, border: `1px solid ${C.skyBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 style={{ width: 22, height: 22, color: C.sky, animation: 'spin 0.8s linear infinite' }} />
        </div>
        <p style={{ fontSize: 13, color: C.textMid, margin: 0, fontWeight: 500 }}>Loading admin panel…</p>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: C.bg, fontFamily: FONT }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.15); border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(148,163,184,0.3); }
        select option { background: #0c1422; color: #f1f5f9; }
      `}</style>

      {/* Ambient background */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 100% 60% at 15% -5%, rgba(56,189,248,0.045) 0%, transparent 55%), radial-gradient(ellipse 70% 50% at 85% 105%, rgba(167,139,250,0.03) 0%, transparent 55%)' }} />

      <AnimatePresence>
        {logoCrop && (
          <LogoCropper
            src={logoCrop}
            busy={uploadingLogo}
            onCancel={() => { if (!uploadingLogo) setLogoCrop(null); }}
            onConfirm={handleCroppedLogo}
          />
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <div className="hidden lg:flex">
        <Sidebar active={activeTab} setActive={setActiveTab} />
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <MobileNav active={activeTab} setActive={setActiveTab} />
        <main style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ maxWidth: 820, margin: '0 auto', padding: '36px 28px 60px' }}>
            {/* Manual-only refresh — admin auto-refresh is disabled */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={manualRefreshing}
                title="Refresh admin data (admin auto-refresh is disabled)"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '8px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 700,
                  cursor: manualRefreshing ? 'wait' : 'pointer', fontFamily: FONT,
                  background: manualRefreshing ? C.surface3 : C.skyLow,
                  border: `1px solid ${C.skyBorder}`,
                  color: C.sky, transition: 'all 0.2s',
                }}>
                {manualRefreshing
                  ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 0.8s linear infinite' }} />
                  : <RefreshCw style={{ width: 13, height: 13 }} />}
                {manualRefreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
              >
                <PageHeader tab={activeTab} />
                {tabContent[activeTab]}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Subscription animation overlay */}
      {previewAnimTier && (
        <SubscriptionAnimation
          tier={previewAnimTier}
          planName={previewAnimTier.charAt(0).toUpperCase() + previewAnimTier.slice(1)}
          onClose={() => setPreviewAnimTier(null)}
        />
      )}
    </div>
  );
}