/* ════════════════════════════════════════════════════════════════════════════
   ADMIN SETTINGS — the control centre, in liquid glass, light and dark
   ────────────────────────────────────────────────────────────────────────────
   A floating glass sidebar (search with Ctrl+K, sections in groups, counts of
   what is waiting) beside a glass top bar and the open section. On a phone the
   sidebar is a drawer. The page follows the site's theme and can switch it; its
   colours are the shared admin tokens (components/admin/adminTheme.js), which the
   panels inside it use too. The open section is kept in the address (#news), so
   a refresh or a shared link lands on it.

   Overview is the first section: the site's state, counts of what is live or
   waiting, the health of the live data, and shortcuts. The TCM and Source Files
   sections were removed (21 Oct 2026).
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Save, Upload, Loader2, X, Palette, Share2, Home,
  ShieldAlert, CloudLightning, Lock,
  Menu as MenuIcon, Zap,
  AlertTriangle, Megaphone, Sun, Moon, CloudRain, Eye, EyeOff,
  Check, Info, RefreshCw, Bell, Layers, Activity, Clock,
  Newspaper, History, FileImage, Plus, Trash2, Edit, Thermometer, Radio,
  Pen, Map as MapIcon, Wind, Snowflake, CloudSnow, Target, Search, LayoutDashboard,
  ExternalLink, Users, Archive, Satellite,
} from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTheme } from '@/components/ThemeContext';
import { AC, ADMIN_FONT, ADMIN_CSS, tint } from '@/components/admin/adminTheme';
import SubscriptionAnimation from '@/components/SubscriptionAnimation';
/* The real brand marks, shared with the social row on the home page so the two
   never drift apart. See that file for why they are not Lucide glyphs. */
import {
  XIcon, FacebookIcon, InstagramIcon, YouTubeIcon, DiscordIcon, BuyMeACoffeeIcon,
} from '@/components/SocialLinks';

import ManualWarningsAdmin from '@/components/ManualWarningsAdmin';
import AccessRequestPanel from '@/components/AccessRequestPanel';
import InvitationLinkGenerator from '@/components/InvitationLinkGenerator';
import AnnouncementsAdmin from '@/components/AnnouncementsAdmin';
import UpdatesTab from '@/components/UpdatesTab';
import StormOutlookGraphicTool from '@/components/StormOutlookGraphicTool';
import SnowOutlookGraphicTool from '@/components/SnowOutlookGraphicTool';
import TrafficLightGraphicTool from '@/components/TrafficLightGraphicTool';
import TemperatureMapTool from '@/components/TemperatureMapTool';
import SolarEclipseGraphicTool from '@/components/SolarEclipseGraphicTool';
import ScenarioForecastTool from '@/components/scenario/ScenarioForecastTool';
import ClimateAnomalyGraphicTool from '@/components/ClimateAnomalyGraphicTool';
import SynopticChartTool from '@/components/synoptic/SynopticChartTool';
import WeatherTypeMapTool from '@/components/synoptic/WeatherTypeMapTool';
import AreasOfInterestTool from '@/components/graphics/AreasOfInterestTool';
import SubscriptionMatrixAdmin from '@/components/SubscriptionMatrixAdmin';
import NewsletterAdmin from '@/components/NewsletterAdmin';

// ─── Design tokens: the shared admin set (CSS variables, light and dark) ───────
const C = AC;
const FONT = ADMIN_FONT;

// ─── Sections ───────────────────────────────────────────────────────────────────
/* `keys` are extra words the sidebar search matches, so "logo" finds General and
   "maintenance" finds Site Control. */
const NAV = [
  { id: 'overview', label: 'Overview',       icon: LayoutDashboard, group: 'Site',    desc: 'Status, counts & shortcuts',        color: '#56b6f5', keys: 'dashboard health status data radar' },
  { id: 'general',  label: 'General',        icon: Palette,         group: 'Site',    desc: 'Branding & identity',               color: '#38bdf8', keys: 'logo banner name version social links twitter facebook instagram youtube discord' },
  { id: 'site',     label: 'Site Control',   icon: Activity,        group: 'Site',    desc: 'Status & weather text',             color: '#4ade80', keys: 'maintenance offline countdown summer theme storm sunny request access page' },
  { id: 'news',     label: 'News',           icon: Newspaper,       group: 'Site',    desc: 'Articles & landing page',           color: '#34d399', keys: 'article landing' },
  { id: 'subscriptions', label: 'Subscriptions', icon: Layers,      group: 'Site',    desc: 'Pricing tiers & API matrix',        color: '#a78bfa', keys: 'pricing tiers plans api' },
  { id: 'warnings', label: 'Warnings',       icon: AlertTriangle,   group: 'Content', desc: 'Manual weather alerts',             color: '#fbbf24', keys: 'alert yellow amber red' },
  { id: 'announce', label: 'Announcements',  icon: Megaphone,       group: 'Content', desc: 'Notices & changelog',               color: '#60a5fa', keys: 'banner notice updates changelog release' },
  // Past & Future Conditions lives inside Graphic Studio: everything under it is a graphic.
  { id: 'storm-graphic', label: 'Graphic Studio', icon: FileImage, group: 'Content', desc: 'Social media & broadcast graphics', color: '#ec4899', keys: 'thunderstorm outlook snow wind temperature areas interest synoptic eclipse climate scenario likelihood' },
  { id: 'newsletter', label: 'Newsletter',   icon: Bell,            group: 'Content', desc: 'Subscribers & weekly email',        color: '#2dd4bf', keys: 'email subscribers' },
  { id: 'access',   label: 'Access',         icon: Lock,            group: 'Access',  desc: 'Codes & requests',                  color: '#f472b6', keys: 'invite invitation code request approve' },
];
const GROUPS = ['Site', 'Content', 'Access'];
const TAB_KEY = 'mwuk_admin_tab';
const tabFromHash = () => {
  const h = (typeof window !== 'undefined' ? window.location.hash : '').replace('#', '');
  return NAV.some((n) => n.id === h) ? h : null;
};


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
    <div className="ad-glass ad-card" style={{
      ...(glow ? { boxShadow: `var(--ad-shadow), inset 0 1px 0 var(--ad-highlight), 0 0 0 1px ${tint(glow, '22')}` } : {}),
      ...style,
    }}>
      {glow && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${tint(glow, '40')}, transparent)` }} />}
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
        <div style={{ width: 40, height: 40, borderRadius: 12, background: `${tint(color, '12')}`, border: `1px solid ${tint(color, '25')}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
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

// ─── General Tab ─────────────────────────────────────────────────────────────────
function GeneralTab({ formData, setFormData, saveMutation, handleImageUpload, uploadingLogo, uploadingBanner, setPreviewAnimTier, dirty, onDiscard }) {
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
            <div className="ad-grid-name">
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
          <div className="ad-grid-2">
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
                  background: `${tint(tier.color, '10')}`,
                  border: `1px solid ${tint(tier.color, '28')}`,
                  color: tier.color,
                  transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', gap: 7,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = `${tint(tier.color, '20')}`; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = `${tint(tier.color, '10')}`; e.currentTarget.style.transform = 'none'; }}
              >
                <Zap style={{ width: 13, height: 13 }} />
                {tier.label}
              </button>
            ))}
          </div>
          <p style={{ margin: '14px 0 0', fontSize: 12, color: C.textFaint }}>Click any tier to preview the full-screen animation overlay.</p>
        </CardBody>
      </Card>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, paddingTop: 4, flexWrap: 'wrap' }}>
        {dirty && (
          <>
            <span className="ad-dirty"><span className="ad-dot" style={{ background: 'currentColor' }} />Unsaved changes</span>
            <button type="button" className="ad-btn" onClick={onDiscard}>Discard</button>
          </>
        )}
        <SaveButton loading={saveMutation.isPending} disabled={!formData.site_name || !dirty} />
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

  /* The summer theme is a site setting, saved the moment it is switched. It used to live only in
     this browser's storage, so it changed the home page for whoever switched it and no one else.
     The storage key is still written, so a home page open in another tab here changes at once. */
  const SUMMER_KEY = 'mwuk_summer_theme';
  const [summerThemeEnabled, setSummerThemeEnabled] = useState(false);
  const handleSummerToggle = async (val) => {
    setSummerThemeEnabled(val);
    try {
      if (settingsId) await base44.entities.SiteSettings.update(settingsId, { summer_theme: val });
      else { const made = await base44.entities.SiteSettings.create({ site_name: 'MyWeatherUK', summer_theme: val }); setSettingsId(made?.id || null); }
      try {
        localStorage.setItem(SUMMER_KEY, String(val));
        window.dispatchEvent(new StorageEvent('storage', { key: SUMMER_KEY, newValue: String(val), storageArea: localStorage }));
      } catch { /* storage blocked */ }
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success(val ? 'Summer theme on for everyone' : 'Default theme restored for everyone');
    } catch (err) {
      setSummerThemeEnabled(!val);
      toast.error(`Could not change the theme${err?.message ? `: ${err.message}` : ''}`);
    }
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
    setSummerThemeEnabled(!!existingSettings.summer_theme);
    try {
      if (existingSettings.storm_text) {
        const p = JSON.parse(existingSettings.storm_text);
        setStormTitle(p.title || '');
        setStormMsg(p.message || '');
      }
      if (existingSettings.sunny_text) { const p = JSON.parse(existingSettings.sunny_text); setSunnyTitle(p.title || ''); setSunnyMsg(p.message || ''); }
    } catch {}
  }, [existingSettings]);

  /* what is on screen against what is saved, so unsaved edits show beside Save */
  const payloadNow = {
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
  const textOf = (raw) => { try { const p = JSON.parse(raw || '{}'); return JSON.stringify({ title: p.title || '', message: p.message || '' }); } catch { return JSON.stringify({ title: '', message: '' }); } };
  const payloadSaved = existingSettings ? {
    site_disabled: existingSettings.site_disabled || false,
    disabled_title: existingSettings.disabled_title || '',
    disabled_message: existingSettings.disabled_message || '',
    countdown_enabled: existingSettings.countdown_enabled || false,
    countdown_target: existingSettings.countdown_target || '',
    countdown_title: existingSettings.countdown_title || '',
    countdown_description: existingSettings.countdown_description || '',
    storm_text: textOf(existingSettings.storm_text),
    sunny_text: textOf(existingSettings.sunny_text),
  } : null;
  const dirty = !!payloadSaved && JSON.stringify(payloadNow) !== JSON.stringify(payloadSaved);

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      const payload = payloadNow;
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
                  <div className="ad-grid-2">
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
            desc="Applies a warm sunset gradient, palm frond decorations and beach accents to the home page hero, for everyone. Saves the moment you switch it."
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
                  Every visitor&rsquo;s home page shows the tropical sunset gradient with palm fronds.
                </p>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Weather Phase Text */}
      <div className="ad-grid-2" style={{ gap: 18 }}>
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
          <div className="ad-grid-4">
            {PHASES.map(({ label, dur, color, bg }) => (
              <div key={label} style={{ padding: '12px 14px', borderRadius: 12, background: bg, border: `1px solid ${tint(color, '20')}`, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color }}>{label}</p>
                <p style={{ margin: 0, fontSize: 10.5, color: C.textFaint, letterSpacing: '0.04em' }}>{dur} · auto</p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
        {dirty && <span className="ad-dirty"><span className="ad-dot" style={{ background: 'currentColor' }} />Unsaved changes</span>}
        <SaveButton loading={saving} disabled={!dirty} />
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
                background: form.category === c.id ? `${tint(c.color, '18')}` : 'transparent',
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
      <div className="ad-grid-2" style={{ gap: 12 }}>
        <Field label="Link URL"><StyledInput placeholder="https://…" value={form.link_url} onChange={e => set('link_url', e.target.value)} /></Field>
        <Field label="Link Label"><StyledInput placeholder="Read more" value={form.link_label} onChange={e => set('link_label', e.target.value)} /></Field>
      </div>

      <Toggle checked={form.published} onChange={v => set('published', v)}
        label="Published" desc="Tick to make this article visible on the News page immediately." />

      {/* Mini preview */}
      {form.title.trim() && (
        <div style={{ padding: '14px 16px', borderRadius: 12, background: `${tint(cat.color, '0d')}`, border: `1px solid ${tint(cat.color, '30')}` }}>
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
          <div className="ad-grid-2" style={{ gap: 12 }}>
            {LANDING_OPTIONS.map(opt => {
              const active = currentLanding === opt.id;
              return (
                <button key={opt.id} type="button"
                  onClick={() => !active && handleSaveLanding(opt.id)}
                  disabled={landingSaving}
                  style={{
                    padding: '16px 18px', borderRadius: 12, cursor: active ? 'default' : 'pointer',
                    border: `1.5px solid ${active ? opt.color : C.border2}`,
                    background: active ? `${tint(opt.color, '12')}` : C.surface3,
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
                    background: C.surface3, border: `1px solid ${a.published ? tint(cat.color, '22') : C.border}`,
                    transition: 'border-color 0.18s',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 3, background: tint(cat.color, '20'), color: cat.color, fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{cat.label}</span>
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

// ─── The shell: sidebar / drawer, top bar ─────────────────────────────────────────
const SHELL_CSS = `
.ad-side { position: sticky; top: 16px; z-index: 2; flex-shrink: 0; width: 272px; height: calc(100vh - 32px); height: calc(100dvh - 32px); margin: 16px 0 16px 16px; display: flex; flex-direction: column; overflow: hidden; border-radius: 26px; }
.ad-brand { display: flex; align-items: center; gap: 12px; padding: 18px 18px 14px; }
.ad-brand img, .ad-brand-mark { width: 40px; height: 40px; flex-shrink: 0; border-radius: 50%; object-fit: cover; display: grid; place-items: center; color: var(--ad-sky); background: var(--ad-sky-low); border: 1px solid var(--ad-border2); }
.ad-brand b { display: block; font-size: 15px; font-weight: 750; letter-spacing: -.02em; line-height: 1.2; }
.ad-brand small { display: block; margin-top: 2px; font-size: 10.5px; font-weight: 650; letter-spacing: .14em; text-transform: uppercase; color: var(--ad-text-faint); }
.ad-search { position: relative; margin: 0 14px 12px; }
.ad-search > svg { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); width: 15px; height: 15px; color: var(--ad-text-faint); pointer-events: none; }
.ad-search input { width: 100%; height: 38px; padding: 0 46px 0 34px; border-radius: 12px; font: inherit; font-size: 14px; color: var(--ad-text); background: var(--ad-surface3); border: 1px solid var(--ad-border2); outline: none; transition: border-color .15s, box-shadow .15s; }
.ad-search input::placeholder { color: var(--ad-text-faint); }
.ad-search input:focus { border-color: var(--ad-sky); box-shadow: 0 0 0 3px var(--ad-sky-low); }
.ad-search kbd { position: absolute; right: 9px; top: 50%; transform: translateY(-50%); font: inherit; font-size: 10.5px; font-weight: 650; padding: 1px 6px; border-radius: 6px; color: var(--ad-text-faint); border: 1px solid var(--ad-border2); pointer-events: none; }
.ad-nav { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 10px 10px; display: flex; flex-direction: column; gap: 14px; }
.ad-nav-group > p { margin: 0 0 6px 10px; font-size: 10.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--ad-text-faint); }
.ad-nav-group > div { display: flex; flex-direction: column; gap: 2px; }
.ad-nav-item { width: 100%; display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 14px; border: 1px solid transparent; background: none; cursor: pointer; text-align: left; font: inherit; color: var(--ad-text-mid); transition: background .15s, border-color .15s, color .15s; }
.ad-nav-item:hover { background: var(--ad-surface2); color: var(--ad-text); }
.ad-nav-item.is-on { background: color-mix(in srgb, var(--c) 14%, transparent); border-color: color-mix(in srgb, var(--c) 32%, transparent); color: var(--ad-text); }
.ad-nav-icon { display: grid; place-items: center; width: 32px; height: 32px; flex-shrink: 0; border-radius: 11px; background: var(--ad-surface2); color: var(--c); }
.ad-nav-item.is-on .ad-nav-icon { background: color-mix(in srgb, var(--c) 22%, transparent); }
.ad-nav-icon svg { width: 15px; height: 15px; }
.ad-nav-text { flex: 1; min-width: 0; }
.ad-nav-text b { display: block; font-size: 13.5px; font-weight: 650; line-height: 1.25; }
.ad-nav-text small { display: block; font-size: 11px; color: var(--ad-text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ad-nav-badge { font-style: normal; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 99px; display: grid; place-items: center; font-size: 11px; font-weight: 750; color: #fff; background: var(--c, var(--ad-red)); }
.ad-nav-empty { margin: 8px 10px; font-size: 12.5px; color: var(--ad-text-dim); }
.ad-side-foot { padding: 10px; border-top: 1px solid var(--ad-border); display: flex; flex-direction: column; gap: 2px; }
.ad-side-link { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border-radius: 12px; font: inherit; font-size: 13px; font-weight: 550; color: var(--ad-text-mid); text-decoration: none; text-align: left; background: none; border: 0; cursor: pointer; }
.ad-side-link:hover { background: var(--ad-surface2); color: var(--ad-text); }
.ad-side-link svg { width: 15px; height: 15px; flex-shrink: 0; }
.ad-side-link em { margin-left: auto; font-style: normal; font-size: 11.5px; color: var(--ad-text-faint); }
.ad-main { position: relative; z-index: 1; flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ad-top { position: sticky; top: 16px; z-index: 20; margin: 16px 16px 0; display: flex; align-items: center; gap: 12px; padding: 10px 10px 10px 14px; border-radius: 20px; }
.ad-top-icon { display: grid; place-items: center; width: 40px; height: 40px; flex-shrink: 0; border-radius: 13px; color: var(--c); background: color-mix(in srgb, var(--c) 16%, transparent); }
.ad-top-icon svg { width: 18px; height: 18px; }
.ad-top-text { min-width: 0; }
.ad-top h1 { margin: 0; font-size: 18px; font-weight: 750; letter-spacing: -.02em; line-height: 1.2; color: var(--ad-text); }
.ad-top p { margin: 1px 0 0; font-size: 12px; color: var(--ad-text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ad-top-actions { margin-left: auto; display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
.ad-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 38px; padding: 0 14px; border-radius: 12px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 650; color: var(--ad-text); background: var(--ad-surface2); border: 1px solid var(--ad-border2); text-decoration: none; white-space: nowrap; transition: border-color .15s, background .15s; }
.ad-btn:hover { border-color: var(--ad-border3); }
.ad-btn.is-icon { width: 38px; padding: 0; }
.ad-btn svg { width: 15px; height: 15px; flex-shrink: 0; }
.ad-btn:disabled { opacity: .55; cursor: wait; }
.ad-menu-btn { display: none !important; }
.ad-content { width: 100%; max-width: 1000px; margin: 0 auto; padding: 22px 24px 72px; }
.ad-drawer-scrim { position: fixed; inset: 0; z-index: 60; background: rgba(2,6,14,.5); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.ad-drawer { position: fixed; z-index: 61; top: 8px; bottom: 8px; left: 8px; width: min(310px, calc(100vw - 40px)); display: flex; flex-direction: column; overflow: hidden; border-radius: 24px; background: var(--ad-bg-alt) !important; }
.ad-drawer-x { position: absolute; top: 14px; right: 12px; }
@media (max-width: 1023px) {
  .ad-side { display: none; }
  .ad-menu-btn { display: inline-flex !important; }
  .ad-top { top: 8px; margin: 8px 8px 0; padding: 8px 8px 8px 10px; }
  .ad-top-icon { width: 36px; height: 36px; }
  .ad-top h1 { font-size: 16px; }
  .ad-top p, .ad-hide-sm { display: none !important; }
  .ad-content { padding: 14px 10px calc(96px + env(safe-area-inset-bottom, 0px)); }
}
/* phones: the site keeps its own 48 px header on top, so the bar sits under it, not behind it */
@media (max-width: 767px) { .ad-top { top: 56px; } }
/* section heroes, tool pickers and tool panels */
.ad-hero { padding: 18px 20px 20px; }
.ad-hero-eyebrow { margin: 0 0 4px; font-size: 10.5px; font-weight: 750; letter-spacing: .16em; text-transform: uppercase; color: var(--c); }
.ad-hero h2 { margin: 0; font-size: 19px; font-weight: 750; letter-spacing: -.02em; color: var(--ad-text); }
.ad-hero > p:not(.ad-hero-eyebrow) { margin: 6px 0 0; max-width: 620px; font-size: 13px; line-height: 1.5; color: var(--ad-text-mid); }
.ad-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(116px, 1fr)); gap: 8px; margin-top: 16px; }
.ad-tile { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 13px 8px 11px; border-radius: 16px; cursor: pointer; font: inherit; text-align: center; color: var(--ad-text-mid); background: var(--ad-surface); border: 1px solid var(--ad-border); transition: background .15s, border-color .15s, transform .15s, box-shadow .15s; }
.ad-tile:hover { background: var(--ad-surface2); color: var(--ad-text); transform: translateY(-1px); }
.ad-tile.is-on { color: var(--ad-text); background: color-mix(in srgb, var(--c) 14%, transparent); border-color: color-mix(in srgb, var(--c) 48%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 30%, transparent); }
.ad-tile > span { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 13px; color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); }
.ad-tile > span svg { width: 19px; height: 19px; }
.ad-tile b { font-size: 11.5px; font-weight: 700; line-height: 1.25; }
.ad-tool { overflow: hidden; }
.ad-tool-head { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--ad-border); }
.ad-tool-head svg { width: 16px; height: 16px; flex-shrink: 0; color: var(--c); }
.ad-tool-head b { font-size: 13px; font-weight: 700; color: var(--ad-text); }
.ad-tool-head small { font-size: 12px; color: var(--ad-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ad-tool-body { padding: 20px 18px; }
.ad-seg { display: inline-flex; gap: 4px; padding: 4px; border-radius: 14px; background: var(--ad-surface3); border: 1px solid var(--ad-border); flex-wrap: wrap; }
.ad-seg button { display: inline-flex; align-items: center; gap: 7px; min-height: 34px; padding: 0 13px; border-radius: 10px; border: 0; cursor: pointer; font: inherit; font-size: 13px; font-weight: 650; color: var(--ad-text-mid); background: transparent; }
.ad-seg button svg { width: 15px; height: 15px; color: var(--c); }
.ad-seg button[aria-pressed='true'] { color: var(--ad-text); background: var(--ad-surface2); box-shadow: var(--ad-shadow), inset 0 0 0 1px color-mix(in srgb, var(--c) 40%, transparent); }
@media (max-width: 720px) {
  .ad-tool-body { padding: 12px 8px; }
  .ad-tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .ad-tile { padding: 11px 4px 9px; }
}
/* overview */
.ad-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: 12px; }
@media (max-width: 520px) { .ad-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } .ad-stat { padding: 13px; } .ad-stat > b { font-size: 24px; } }
.ad-stat { display: flex; flex-direction: column; gap: 6px; padding: 16px; text-align: left; font: inherit; color: inherit; cursor: pointer; text-decoration: none; transition: transform .2s; }
.ad-stat:hover { transform: translateY(-2px); }
.ad-stat-top { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ad-text-faint); }
.ad-stat-top svg { width: 15px; height: 15px; color: var(--c); }
.ad-stat > b { display: flex; align-items: center; gap: 8px; font-size: 28px; font-weight: 750; letter-spacing: -.03em; line-height: 1.05; color: var(--ad-text); }
.ad-stat > small { font-size: 12.5px; line-height: 1.4; color: var(--ad-text-mid); }
.ad-dot { display: inline-block; width: 9px; height: 9px; flex-shrink: 0; border-radius: 99px; }
.ad-section-title { margin: 24px 4px 10px; font-size: 11.5px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; color: var(--ad-text-faint); }
.ad-health { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px; padding: 12px; }
.ad-health-row { display: flex; align-items: center; gap: 10px; padding: 11px 12px; border-radius: 14px; font-size: 13px; background: var(--ad-surface2); border: 1px solid var(--ad-border); }
.ad-health-row b { flex: 1; min-width: 0; font-weight: 650; color: var(--ad-text); }
.ad-health-row b small { display: block; margin-top: 1px; font-size: 11.5px; font-weight: 500; color: var(--ad-text-dim); }
.ad-health-row span { color: var(--ad-text-mid); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ad-quick { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.ad-action { display: flex; align-items: center; gap: 12px; padding: 12px 14px; text-align: left; font: inherit; color: var(--ad-text); cursor: pointer; text-decoration: none; border-radius: 18px !important; transition: transform .2s; }
.ad-action:hover { transform: translateY(-2px); }
.ad-action > span { display: grid; place-items: center; width: 38px; height: 38px; flex-shrink: 0; border-radius: 12px; color: var(--c); background: color-mix(in srgb, var(--c) 15%, transparent); }
.ad-action svg { width: 17px; height: 17px; }
.ad-action b { display: block; font-size: 13.5px; font-weight: 650; }
.ad-action small { display: block; font-size: 11.5px; color: var(--ad-text-dim); }
.ad-dirty { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600; color: var(--ad-amber); }
.ad-grid-name { display: grid; grid-template-columns: minmax(0, 1fr) 150px; gap: 14px; }
@media (max-width: 720px) { .ad-grid-name { grid-template-columns: minmax(0, 1fr); } }
`;

/* the sections, filtered by the search, in their groups, with a count where something waits */
function NavList({ active, go, query, counts }) {
  const q = query.trim().toLowerCase();
  const items = NAV.filter((n) => !q || `${n.label} ${n.desc} ${n.keys || ''}`.toLowerCase().includes(q));
  if (!items.length) return <p className="ad-nav-empty">No section matches &ldquo;{query}&rdquo;.</p>;
  return GROUPS.map((group) => {
    const list = items.filter((n) => n.group === group);
    if (!list.length) return null;
    return (
      <div key={group} className="ad-nav-group">
        <p>{group}</p>
        <div>
          {list.map((item) => {
            const Icon = item.icon;
            const n = counts?.[item.id];
            return (
              <button key={item.id} type="button" className={`ad-nav-item${active === item.id ? ' is-on' : ''}`} style={{ '--c': item.color }}
                aria-current={active === item.id ? 'page' : undefined} onClick={() => go(item.id)}>
                <span className="ad-nav-icon"><Icon /></span>
                <span className="ad-nav-text"><b>{item.label}</b><small>{item.desc}</small></span>
                {n ? <em className="ad-nav-badge" title={`${n} waiting`}>{n}</em> : null}
              </button>
            );
          })}
        </div>
      </div>
    );
  });
}

function NavPanel({ active, go, counts, logoUrl, siteName, searchRef, isDark, toggleTheme }) {
  const [query, setQuery] = useState('');
  const pick = (id) => { setQuery(''); go(id); };
  const q = query.trim().toLowerCase();
  const first = NAV.find((n) => q && `${n.label} ${n.desc} ${n.keys || ''}`.toLowerCase().includes(q));
  return (
    <>
      <div className="ad-brand">
        {logoUrl ? <img src={logoUrl} alt="" /> : <span className="ad-brand-mark"><ShieldAlert size={18} /></span>}
        <div style={{ minWidth: 0 }}><b>{siteName || 'MyWeatherUK'}</b><small>Control centre</small></div>
      </div>
      <label className="ad-search">
        <Search />
        <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a section"
          aria-label="Find a section" onKeyDown={(e) => { if (e.key === 'Enter' && first) pick(first.id); if (e.key === 'Escape') setQuery(''); }} />
        <kbd>Ctrl K</kbd>
      </label>
      <nav className="ad-nav" aria-label="Admin sections">
        <NavList active={active} go={pick} query={query} counts={counts} />
      </nav>
      <div className="ad-side-foot">
        <button type="button" className="ad-side-link" onClick={toggleTheme}>
          {isDark ? <Sun /> : <Moon />}{isDark ? 'Light mode' : 'Dark mode'}<em>site-wide</em>
        </button>
        <Link to="/" className="ad-side-link"><Home style={{ color: 'var(--ad-sky)' }} />Back to the site</Link>
        <Link to="/Lightning" className="ad-side-link"><CloudLightning style={{ color: 'var(--ad-violet)' }} />Lightning</Link>
        <Link to="/LiveStream" className="ad-side-link"><Radio style={{ color: '#e0322f' }} />Live Stream</Link>
      </div>
    </>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────────
const ago = (iso) => {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return 'never';
  const m = Math.round((Date.now() - t) / 60e3);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const ukTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

function Stat({ icon: Icon, color, label, value, sub, onClick, to }) {
  const body = (
    <>
      <span className="ad-stat-top"><Icon />{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </>
  );
  return to
    ? <Link to={to} className="ad-glass ad-stat" style={{ '--c': color }}>{body}</Link>
    : <button type="button" className="ad-glass ad-stat" style={{ '--c': color }} onClick={onClick}>{body}</button>;
}

function OverviewTab({ go, data }) {
  const { settings, graphics, warnings, notices, articles, requests, subscribers } = data;
  const { data: live } = useQuery({
    queryKey: ['admin-live-health'],
    queryFn: async () => {
      const get = (u) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const [cat, lt] = await Promise.all([get('/api/modeldata/live/catalog'), get('/api/modeldata/live/lightning')]);
      return { cat, lightning: lt ? { feed: lt.feed_updated || lt.updated, strikes: lt.strikes?.length || 0 } : null };
    },
    refetchInterval: 60_000,
  });
  const now = Date.now();
  const inForce = graphics.filter((g) => g.is_forecast !== false && g.published !== false && !g.is_archived && (!g.expires_at || Date.parse(g.expires_at) > now));
  const archived = graphics.filter((g) => g.is_archived || (g.expires_at && Date.parse(g.expires_at) <= now)).length;
  const lastIssued = graphics.reduce((m, g) => (g.created_date && (!m || g.created_date > m) ? g.created_date : m), null);
  const activeWarn = warnings.filter((w) => w.status === 'active').length;
  const upcomingWarn = warnings.filter((w) => w.status === 'upcoming').length;
  const liveNotices = notices.filter((n) => n.is_active).length;
  const published = articles.filter((a) => a.published).length;
  const pending = requests.filter((r) => r.status === 'pending').length;
  const offline = !!settings?.site_disabled;

  const newest = (k) => live?.cat?.products?.[k]?.times?.at(-1);
  const feed = (label, iso, okMin) => {
    const t = Date.parse(iso || '');
    const age = Number.isFinite(t) ? (now - t) / 60e3 : Infinity;
    const colour = age <= okMin ? '#22c55e' : age <= okMin * 3 ? '#f59e0b' : '#ef4444';
    return { label, when: Number.isFinite(t) ? `${new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })} · ${ago(iso)}` : 'no data', colour };
  };
  const feeds = live ? [
    feed('Met Office radar', newest('radar'), 40),
    feed('Right now (UKV + stations)', newest('now_t2'), 60),
    feed('Satellite (Meteosat)', newest('sat_ir'), 60),
    { ...feed('Met Office lightning', live.lightning?.feed, 20), extra: live.lightning ? `${live.lightning.strikes} strikes in the last 12 h` : '' },
  ] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="ad-stats">
        <Stat icon={Activity} color={offline ? '#ef4444' : '#22c55e'} label="Site" onClick={() => go('site')}
          value={<><span className="ad-dot" style={{ background: offline ? '#ef4444' : '#22c55e', boxShadow: `0 0 0 4px ${tint(offline ? '#ef4444' : '#22c55e', '30')}` }} />{offline ? 'Maintenance' : 'Live'}</>}
          sub={offline ? 'Visitors see the maintenance page' : `Landing page: ${settings?.landing_page || 'Home'}${settings?.summer_theme ? ' · summer theme on' : ''}`} />
        <Stat icon={FileImage} color="#ec4899" label="Graphics in force" to="/#forecasts" value={inForce.length}
          sub={`${archived} in the archive${lastIssued ? ` · last issued ${ukTime(lastIssued)}` : ''}`} />
        <Stat icon={AlertTriangle} color="#f59e0b" label="Warnings" onClick={() => go('warnings')} value={activeWarn}
          sub={`active now${upcomingWarn ? ` · ${upcomingWarn} upcoming` : ''} · ${warnings.length} in total`} />
        <Stat icon={Megaphone} color="#60a5fa" label="Announcements" onClick={() => go('announce')} value={liveNotices} sub={`showing on the site · ${notices.length} in total`} />
        <Stat icon={Newspaper} color="#34d399" label="News" onClick={() => go('news')} value={published} sub={`published · ${articles.length - published} draft${articles.length - published === 1 ? '' : 's'}`} />
        <Stat icon={Users} color="#f472b6" label="Access requests" onClick={() => go('access')} value={pending} sub={pending ? 'waiting for a decision' : 'nothing waiting'} />
        <Stat icon={Bell} color="#2dd4bf" label="Newsletter" onClick={() => go('newsletter')} value={subscribers.length} sub="subscribers" />
      </div>

      <p className="ad-section-title">Live data</p>
      <div className="ad-glass ad-health">
        {!live && <div className="ad-health-row"><Loader2 style={{ width: 15, height: 15, animation: 'spin .8s linear infinite' }} /><b>Checking the live feeds…</b></div>}
        {feeds.map((f) => (
          <div key={f.label} className="ad-health-row">
            <span className="ad-dot" style={{ background: f.colour, boxShadow: `0 0 0 4px ${tint(f.colour, '30')}` }} />
            <b>{f.label}{f.extra && <small>{f.extra}</small>}</b>
            <span>{f.when}</span>
          </div>
        ))}
      </div>

      <p className="ad-section-title">Shortcuts</p>
      <div className="ad-quick">
        {[
          { icon: FileImage, color: '#ec4899', title: 'Graphic Studio', sub: 'Make an outlook or map', onClick: () => go('storm-graphic') },
          { icon: Plus, color: '#38bdf8', title: 'Add a forecast graphic', sub: 'On the home page', to: '/#forecasts' },
          { icon: AlertTriangle, color: '#f59e0b', title: 'Issue a warning', sub: 'Manual weather alert', onClick: () => go('warnings') },
          { icon: Megaphone, color: '#60a5fa', title: 'Post an announcement', sub: 'Banner across the site', onClick: () => go('announce') },
          { icon: Newspaper, color: '#34d399', title: 'Write a news article', sub: 'The News page', onClick: () => go('news') },
          { icon: Archive, color: '#a78bfa', title: 'Graphics archive', sub: 'Everything that has ended', to: '/MyWeatherArchive' },
          { icon: Satellite, color: '#22d3ee', title: 'Model data', sub: 'Radar, satellite, models', to: '/ModelData' },
        ].map((a) => {
          const inner = (<><span><a.icon /></span><div><b>{a.title}</b><small>{a.sub}</small></div></>);
          return a.to
            ? <Link key={a.title} to={a.to} className="ad-glass ad-action" style={{ '--c': a.color }}>{inner}</Link>
            : <button key={a.title} type="button" className="ad-glass ad-action" style={{ '--c': a.color }} onClick={a.onClick}>{inner}</button>;
        })}
      </div>
    </div>
  );
}

// ─── Section hero with a tool picker, and the open tool's panel ────────────────────
function ToolPicker({ eyebrow, title, desc, color, tools, value, onPick }) {
  return (
    <div className="ad-glass ad-hero" style={{ '--c': color }}>
      {eyebrow && <p className="ad-hero-eyebrow">{eyebrow}</p>}
      {title && <h2>{title}</h2>}
      {desc && <p>{desc}</p>}
      <div className="ad-tiles" role="tablist" aria-label={title || eyebrow}>
        {tools.map((t) => {
          const TIcon = t.icon;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className={`ad-tile${value === t.id ? ' is-on' : ''}`}
              style={{ '--c': t.color }} onClick={() => onPick(t.id)} title={t.desc}>
              <span><TIcon /></span><b>{t.label}</b>
            </button>
          );
        })}
      </div>
    </div>
  );
}
/* `studio`: the graphic tools are dark by design (their controls and the graphics they make), so
   they keep a dark panel in the light theme too, rather than a half-dark mix */
function ToolPanel({ tool, studio, children }) {
  const TIcon = tool.icon;
  return (
    <div className="ad-glass ad-tool" style={{ '--c': tool.color }}>
      <div className="ad-tool-head"><TIcon /><b>{tool.label}</b><small>{tool.desc}</small></div>
      <div className={`ad-tool-body${studio ? ' ad-studio' : ''}`}>{children}</div>
    </div>
  );
}

// ─── Announcements & Updates ──────────────────────────────────────────────────
// One tab, two sections: an announcement is a notice that something is happening,
// an update is a changelog entry recording that something changed.
function NoticesTab() {
  const [sub, setSub] = useState('announce');
  const SUBS = [
    { id: 'announce', label: 'Announcements', icon: Megaphone, color: '#60a5fa', desc: 'Site-wide notices, shown in the banner at the top of every page.' },
    { id: 'updates',  label: 'Updates',       icon: History,   color: '#a78bfa', desc: 'Changelog entries and release notes: what changed, and when.' },
  ];
  const cur = SUBS.find((s) => s.id === sub) || SUBS[0];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="ad-glass ad-hero" style={{ '--c': cur.color, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <p className="ad-hero-eyebrow">Announcements &amp; Updates</p>
          <h2>{cur.label}</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--ad-text-mid)' }}>{cur.desc}</p>
        </div>
        <div className="ad-seg" role="tablist">
          {SUBS.map((s) => (
            <button key={s.id} type="button" role="tab" aria-pressed={sub === s.id} style={{ '--c': s.color }} onClick={() => setSub(s.id)}>
              <s.icon />{s.label}
            </button>
          ))}
        </div>
      </div>
      {sub === 'announce' ? <AnnouncementsAdmin /> : <UpdatesTab />}
    </div>
  );
}

/* ─── Map Drawing ──────────────────────────────────────────────────
   Hand-drawn charts sharing a coastline layer and drawing primitives
   (lib/synopticGeo.js, components/synoptic/synopticDraw.jsx):
     Synoptic Chart  fronts, isobars, the jet, pressure centres.
     Weather Types   coloured areas clipped to land, with a key.            */
function MapDrawingSection({ logoUrl }) {
  const [sub, setSub] = useState('synoptic');
  const TOOLS = [
    { id: 'synoptic', label: 'Synoptic Chart', icon: Wind,    color: '#5b6ee8', desc: 'Fronts, isobars, jet stream & pressure centres' },
    { id: 'wxtypes',  label: 'Weather Types',  icon: MapIcon, color: '#a3c614', desc: 'Weather-type areas with a key & likelihood' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="ad-seg" role="tablist" style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,.05)', borderColor: 'rgba(255,255,255,.1)' }}>
        {TOOLS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-pressed={sub === t.id} title={t.desc} onClick={() => setSub(t.id)}
            style={{ '--c': t.color, color: sub === t.id ? '#f8fafc' : 'rgba(203,213,225,.75)', background: sub === t.id ? 'rgba(255,255,255,.1)' : 'transparent' }}>
            <t.icon />{t.label}
          </button>
        ))}
      </div>
      {sub === 'synoptic' ? <SynopticChartTool siteLogoUrl={logoUrl} /> : <WeatherTypeMapTool siteLogoUrl={logoUrl} />}
    </div>
  );
}

// ─── Graphic Studio ─────────────────────────────────────────────────────────────
const STUDIO_TOOLS = [
  { id: 'outlook',  label: 'Thunderstorm Outlook', icon: CloudLightning, color: '#eab308', desc: 'Full risk map with timeline & drawing' },
  { id: 'snow',     label: 'Snow Chance',          icon: Snowflake,      color: '#38bdf8', desc: 'Snow chance map with timeline, drawing & model snowfall' },
  { id: 'snowacc',  label: 'Snow Accumulation',    icon: Layers,         color: '#60a5fa', desc: 'Snow depth (cm) map with timeline & drawing' },
  { id: 'snowrisk', label: 'Snow Risk',            icon: CloudSnow,      color: '#a78bfa', desc: 'Snow disruption risk map with timeline & drawing' },
  { id: 'wind',     label: 'Wind',                 icon: Wind,           color: '#fb923c', desc: 'Gust map (mph) with timeline & drawing' },
  { id: 'temp',     label: 'Temperature Map',      icon: Thermometer,    color: '#f59e0b', desc: 'Live UK temperature surface' },
  { id: 'interest', label: 'Areas of Interest',    icon: Target,         color: '#22c55e', desc: 'Draw areas to keep an eye on, with what and when' },
  { id: 'mapdraw',  label: 'Map Drawing',          icon: Pen,            color: '#6366f1', desc: 'Synoptic charts & weather-type areas' },
  { id: 'pastfut',  label: 'Past & Future',        icon: History,        color: '#06b6d4', desc: 'Climate anomalies, likelihood & scenarios' },
  { id: 'eclipse',  label: 'Solar Eclipse',        icon: Sun,            color: '#d946ef', desc: 'Coverage map with per-location times & weather symbols' },
];
const STUDIO_KEY = 'mwuk_admin_studio_tool';

function StormGraphicTab({ logoUrl }) {
  /* the tool last used is the one that opens */
  const [sub, setSub] = useState(() => { try { const s = localStorage.getItem(STUDIO_KEY); return STUDIO_TOOLS.some((t) => t.id === s) ? s : 'outlook'; } catch { return 'outlook'; } });
  useEffect(() => { try { localStorage.setItem(STUDIO_KEY, sub); } catch { /* storage blocked */ } }, [sub]);
  const cur = STUDIO_TOOLS.find((s) => s.id === sub);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ToolPicker eyebrow="Graphic Studio" title="Make a graphic" color="#ec4899" tools={STUDIO_TOOLS} value={sub} onPick={setSub}
        desc="Broadcast-quality graphics for social media: thunderstorm and snow outlooks, wind and temperature maps, hand-drawn charts and more. Draw, then export." />
      <ToolPanel tool={cur} studio>
        {sub === 'outlook'  && <StormOutlookGraphicTool myWeatherLogoUrl={logoUrl} />}
        {sub === 'snow'     && <SnowOutlookGraphicTool key="chance" variant="chance" myWeatherLogoUrl={logoUrl} />}
        {sub === 'snowacc'  && <SnowOutlookGraphicTool key="accumulation" variant="accumulation" myWeatherLogoUrl={logoUrl} />}
        {sub === 'snowrisk' && <SnowOutlookGraphicTool key="risk" variant="risk" myWeatherLogoUrl={logoUrl} />}
        {sub === 'wind'     && <SnowOutlookGraphicTool key="wind" variant="wind" myWeatherLogoUrl={logoUrl} />}
        {sub === 'temp'     && <TemperatureMapTool />}
        {sub === 'interest' && <AreasOfInterestTool siteLogoUrl={logoUrl} />}
        {sub === 'mapdraw'  && <MapDrawingSection logoUrl={logoUrl} />}
        {sub === 'pastfut'  && <PastFutureTools logoUrl={logoUrl} />}
        {sub === 'eclipse'  && <SolarEclipseGraphicTool />}
      </ToolPanel>
    </div>
  );
}

// ─── Past & Future (inside Graphic Studio) ─────────────────────────────────────
// How a month actually turned out against the long-term average, and how a coming
// period might play out.
function PastFutureTools({ logoUrl }) {
  const [sub, setSub] = useState('climate');
  const SUBS = [
    { id: 'climate',  label: 'Monthly Climate',   icon: CloudRain, color: '#22d3ee', desc: 'Rainfall, temperature, sun & cloud vs the 1991–2020 average' },
    { id: 'traffic',  label: 'Likelihood Card',   icon: Activity,  color: '#38bdf8', desc: 'Traffic-light risk tiers for social' },
    { id: 'scenario', label: 'Scenario Forecast', icon: Layers,    color: '#34d399', desc: '3-way synoptic scenario board' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="ad-seg" role="tablist" style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,.05)', borderColor: 'rgba(255,255,255,.1)' }}>
        {SUBS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-pressed={sub === s.id} title={s.desc} onClick={() => setSub(s.id)}
            style={{ '--c': s.color, color: sub === s.id ? '#f8fafc' : 'rgba(203,213,225,.75)', background: sub === s.id ? 'rgba(255,255,255,.1)' : 'transparent' }}>
            <s.icon />{s.label}
          </button>
        ))}
      </div>
      {sub === 'climate'
        ? <ClimateAnomalyGraphicTool siteLogoUrl={logoUrl} />
        : sub === 'traffic'
          ? <TrafficLightGraphicTool siteLogoUrl={logoUrl} />
          : <ScenarioForecastTool siteLogoUrl={logoUrl} />}
    </div>
  );
}

// ─── Main export ────────────────────────────────────────────────────────────────
const SETTINGS_FIELDS = ['site_name', 'description', 'logo_url', 'banner_url', 'version', 'twitter_url', 'facebook_url', 'instagram_url', 'youtube_url', 'discord_url', 'buymeacoffee_url'];
const formFrom = (s) => Object.fromEntries(SETTINGS_FIELDS.map((k) => [k, s?.[k] || '']));
const listOf = (entity, order) => async () => { try { return (await base44.entities[entity].list(order)) || []; } catch { return []; } };

export default function AdminSettings() {
  const queryClient = useQueryClient();
  const { isDark, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState(() => {
    try { return tabFromHash() || (NAV.some((n) => n.id === localStorage.getItem(TAB_KEY)) ? localStorage.getItem(TAB_KEY) : 'overview'); } catch { return 'overview'; }
  });
  const [drawer, setDrawer] = useState(false);
  const [formData, setFormData] = useState(() => formFrom(null));
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  /* The data URL of a logo waiting to be cropped. Held here rather than in the
     slot so the cropper can be a full-screen overlay. */
  const [logoCrop, setLogoCrop] = useState(null);
  const [previewAnimTier, setPreviewAnimTier] = useState(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const searchRef = useRef(null);

  /* the open section lives in the address, so a refresh or a shared link lands on it */
  const go = (id) => {
    setActiveTab(id);
    setDrawer(false);
    try { localStorage.setItem(TAB_KEY, id); } catch { /* storage blocked */ }
    if (window.location.hash !== `#${id}`) window.history.replaceState(null, '', `#${id}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  useEffect(() => {
    const onHash = () => { const h = tabFromHash(); if (h) setActiveTab(h); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  /* Ctrl+K (or /) finds a section; Escape closes the drawer */
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        if (window.matchMedia('(max-width: 1023px)').matches) setDrawer(true);
        else searchRef.current?.focus();
      } else if (e.key === 'Escape') setDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Admin data refreshes on the Refresh button, not on a timer.
  const { data: existingSettings, isLoading, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => { const list = await base44.entities.SiteSettings.list(); return list[0] || null; },
    refetchOnWindowFocus: false,
    refetchInterval: false,
    staleTime: Infinity,
  });
  /* what the overview counts and the sidebar badges read */
  const ov = { staleTime: 60_000, refetchOnWindowFocus: false };
  const { data: graphics = [] } = useQuery({ queryKey: ['admin-ov', 'WeatherGraphic'], queryFn: listOf('WeatherGraphic', '-created_date'), ...ov });
  const { data: warnings = [] } = useQuery({ queryKey: ['admin-ov', 'ManualWarning'], queryFn: listOf('ManualWarning'), ...ov });
  const { data: notices = [] } = useQuery({ queryKey: ['admin-ov', 'Announcement'], queryFn: listOf('Announcement'), ...ov });
  const { data: articles = [] } = useQuery({ queryKey: ['admin-ov', 'NewsArticle'], queryFn: listOf('NewsArticle'), ...ov });
  const { data: requests = [] } = useQuery({ queryKey: ['admin-ov', 'AccessRequest'], queryFn: listOf('AccessRequest'), ...ov });
  const { data: subscribers = [] } = useQuery({ queryKey: ['admin-ov', 'NewsletterSubscriber'], queryFn: listOf('NewsletterSubscriber'), ...ov });
  const counts = {
    access: requests.filter((r) => r.status === 'pending').length,
    warnings: warnings.filter((w) => w.status === 'active').length,
  };

  const handleManualRefresh = async () => {
    setManualRefreshing(true);
    try {
      await queryClient.invalidateQueries();
      await refetch();
      toast.success('Refreshed');
    } catch { toast.error('Refresh failed'); }
    finally { setManualRefreshing(false); }
  };

  useEffect(() => { if (existingSettings) setFormData(formFrom(existingSettings)); }, [existingSettings]);
  /* General's unsaved edits: shown beside its Save button, and asked about before leaving the page */
  const generalDirty = JSON.stringify(formData) !== JSON.stringify(formFrom(existingSettings));
  useEffect(() => {
    if (!generalDirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [generalDirty]);

  const saveMutation = useMutation({
    mutationFn: async (data) =>
      existingSettings
        ? base44.entities.SiteSettings.update(existingSettings.id, data)
        : base44.entities.SiteSettings.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['settings'] }); toast.success('Settings saved'); },
    onError: (e) => toast.error(`Could not save the settings${e?.message ? `: ${e.message}` : ''}`),
  });

  const handleImageUpload = async (e, type) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
      setFormData((prev) => ({ ...prev, banner_url: file_url }));
    } catch (err) {
      // a failed upload used to vanish silently, leaving the old banner in place
      toast.error(`The banner could not be uploaded${err?.message ? `: ${err.message}` : ''}`);
    } finally {
      setUploadingBanner(false);
      e.target.value = '';
    }
  };

  /* The cropper hands back a circular PNG; this puts it where the banner path
     puts its file. Still needs Save, like every other field on this form. */
  const handleCroppedLogo = async (file) => {
    setUploadingLogo(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setFormData((prev) => ({ ...prev, logo_url: file_url }));
      setLogoCrop(null);
      toast.success('Logo cropped — press Save to publish it');
    } catch {
      toast.error('The cropped logo could not be uploaded');
    } finally {
      setUploadingLogo(false);
    }
  };

  const cur = NAV.find((n) => n.id === activeTab) || NAV[0];
  const CurIcon = cur.icon;
  const tabContent = {
    overview: <OverviewTab go={go} data={{ settings: existingSettings, graphics, warnings, notices, articles, requests, subscribers }} />,
    general:  <GeneralTab formData={formData} setFormData={setFormData} saveMutation={saveMutation} handleImageUpload={handleImageUpload} uploadingLogo={uploadingLogo} uploadingBanner={uploadingBanner} setPreviewAnimTier={setPreviewAnimTier} dirty={generalDirty} onDiscard={() => setFormData(formFrom(existingSettings))} />,
    site:     <SiteControlTab />,
    news:     <NewsTab />,
    subscriptions: <SubscriptionMatrixAdmin />,
    warnings: <ManualWarningsAdmin />,
    announce: <NoticesTab />,
    'storm-graphic': <StormGraphicTab logoUrl={formData.logo_url} />,
    newsletter: <NewsletterAdmin />,
    access: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <InvitationLinkGenerator />
        <AccessRequestPanel />
      </div>
    ),
  };
  const navProps = { active: activeTab, go, counts, logoUrl: formData.logo_url || existingSettings?.logo_url, siteName: existingSettings?.site_name, isDark, toggleTheme };

  return (
    <div className={`ad-root${isDark ? '' : ' is-light'}`}>
      <style>{ADMIN_CSS + SHELL_CSS}</style>
      <div className="ad-ambient" aria-hidden="true"><i /><i /><i /></div>

      <AnimatePresence>
        {logoCrop && (
          <LogoCropper src={logoCrop} busy={uploadingLogo} onCancel={() => { if (!uploadingLogo) setLogoCrop(null); }} onConfirm={handleCroppedLogo} />
        )}
      </AnimatePresence>

      <aside className="ad-glass ad-side"><NavPanel {...navProps} searchRef={searchRef} /></aside>

      <AnimatePresence>
        {drawer && (
          <>
            <motion.div key="scrim" className="ad-drawer-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)} />
            <motion.aside key="drawer" className="ad-glass ad-drawer" initial={{ x: -330 }} animate={{ x: 0 }} exit={{ x: -330 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}>
              <button type="button" className="ad-btn is-icon ad-drawer-x" onClick={() => setDrawer(false)} aria-label="Close the menu"><X /></button>
              <NavPanel {...navProps} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="ad-main">
        <header className="ad-glass ad-top" style={{ '--c': cur.color }}>
          <button type="button" className="ad-btn is-icon ad-menu-btn" onClick={() => setDrawer(true)} aria-label="Open the menu"><MenuIcon /></button>
          <span className="ad-top-icon"><CurIcon /></span>
          <div className="ad-top-text">
            <h1>{cur.label}</h1>
            <p>Admin · {cur.desc}</p>
          </div>
          <div className="ad-top-actions">
            <button type="button" className="ad-btn is-icon" onClick={toggleTheme} aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} title={isDark ? 'Light mode' : 'Dark mode'}>
              {isDark ? <Sun /> : <Moon />}
            </button>
            <button type="button" className="ad-btn" onClick={handleManualRefresh} disabled={manualRefreshing} title="Reload the admin data">
              {manualRefreshing ? <Loader2 style={{ animation: 'spin .8s linear infinite' }} /> : <RefreshCw />}
              <span className="ad-hide-sm">{manualRefreshing ? 'Refreshing…' : 'Refresh'}</span>
            </button>
            <Link to="/" className="ad-btn ad-hide-sm"><ExternalLink />View site</Link>
          </div>
        </header>

        <main className="ad-content">
          {isLoading ? (
            <div className="ad-glass" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 22, color: C.textMid, fontSize: 14 }}>
              <Loader2 style={{ width: 18, height: 18, color: C.sky, animation: 'spin .8s linear infinite' }} />Loading the admin panel…
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}>
                {tabContent[activeTab]}
              </motion.div>
            </AnimatePresence>
          )}
        </main>
      </div>

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
