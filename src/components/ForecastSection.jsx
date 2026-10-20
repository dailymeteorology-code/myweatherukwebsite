import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CloudSun, X, Upload, Loader2,
  ChevronRight, MapPin, Check, Plus, Archive,
  AlertTriangle, Zap, Wind, Droplets, Snowflake, Flame,
  Bold, Italic, Palette, Edit2, Flag, RefreshCw, ChevronDown, Maximize2
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isValid, isPast } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import ForecastFurtherInfo from './ForecastFurtherInfo';
import ThunderstormPanel from './ThunderstormPanel';
import { ThunderstormRisks, GRAPHIC_LEVEL_NAMES, GRAPHIC_LEVEL_STYLE, GRAPHIC_LEVEL_LABEL } from '@/components/graphics/GraphicMeta';
import { sized, sizedSet } from '@/lib/sizedImage';
import { cleanHtml, plainText } from '@/lib/cleanHtml';
import GraphicViewer from '@/components/graphics/GraphicViewer';


/* ─────────────────────────────────────────────
   BST FORMATTING
───────────────────────────────────────────── */
const BST_TZ = 'Europe/London';

function formatBST(iso, fmt = 'dd MMM, HH:mm') {
  if (!iso) return null;
  const d = new Date(iso);
  if (!isValid(d)) return null;
  const zoned = toZonedTime(d, BST_TZ);
  return format(zoned, fmt);
}

function formatExpiryBST(iso) {
  return formatBST(iso, 'dd MMM yyyy, HH:mm');
}

/* ─────────────────────────────────────────────
   DESIGN TOKENS
───────────────────────────────────────────── */
const CONDITION_CONFIG = {
  Snow:         { accent: '#7dd3fc', dim: 'rgba(125,211,252,0.1)',  border: 'rgba(125,211,252,0.2)',  text: '#bae6fd', Icon: Snowflake  },
  Ice:          { accent: '#67e8f9', dim: 'rgba(103,232,249,0.1)',  border: 'rgba(103,232,249,0.2)',  text: '#a5f3fc', Icon: Droplets   },
  Thunderstorms:{ accent: '#c084fc', dim: 'rgba(192,132,252,0.1)', border: 'rgba(192,132,252,0.2)', text: '#e9d5ff', Icon: Zap        },
  Rain:         { accent: '#60a5fa', dim: 'rgba(96,165,250,0.1)',   border: 'rgba(96,165,250,0.2)',   text: '#bfdbfe', Icon: Droplets   },
  Wind:         { accent: '#2dd4bf', dim: 'rgba(45,212,191,0.1)',   border: 'rgba(45,212,191,0.2)',   text: '#99f6e4', Icon: Wind       },
  Heat:         { accent: '#fb923c', dim: 'rgba(251,146,60,0.1)',   border: 'rgba(251,146,60,0.25)',  text: '#fed7aa', Icon: Flame      },
  'Daily Risks':{ accent: '#fbbf24', dim: 'rgba(251,191,36,0.1)',   border: 'rgba(251,191,36,0.2)',   text: '#fde68a', Icon: AlertTriangle },
};
const DEFAULT_CFG = { accent: '#94a3b8', dim: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.2)', text: '#cbd5e1', Icon: CloudSun };

/* ─────────────────────────────────────────────
   IMPACT / RISK LEVELS
   Very Low (dark green) · Low (light green) · Marginal (yellow)
   · Slight (orange/amber) · Moderate (red) · High (purple)
   · Severe (black, outlined)
───────────────────────────────────────────── */
/* The risk ladder and its colours are the studio's, not a private copy — see
   GRAPHIC_RISK_LEVELS in components/graphics/GraphicMeta. This file used to
   define its own seven bands with its own palette, so "Very Low" was green on a
   forecast graphic and blue in the studio, and Conditional Severe could not be
   set on a graphic at all. */
const IMPACT_CONFIG = GRAPHIC_LEVEL_STYLE;
const IMPACT_LEVELS = GRAPHIC_LEVEL_NAMES;

const CONDITIONS = Object.keys(CONDITION_CONFIG);

/* ─────────────────────────────────────────────
   PER-CONDITION SUB-TYPES
   Each condition exposes a list of selectable
   sub-type tags so a forecast can be more specific.
───────────────────────────────────────────── */
const CONDITION_SUBTYPES = {
  Snow: [
    'Light Snow', 'Heavy Snow', 'Snow Showers', 'Sleet',
    'Blizzard', 'Drifting Snow', 'Snow & Ice Mix',
  ],
  Ice: [
    'Ice on Untreated Surfaces', 'Black Ice', 'Freezing Rain',
    'Hard Frost', 'Icy Patches', 'Glaze Ice',
  ],
  Thunderstorms: [
    'Thundery Shower', 'Isolated Thunderstorm', 'Scattered Thunderstorms',
    'Severe Thunderstorm', 'Embedded Thunderstorms', 'Frequent Lightning',
  ],
  Rain: [
    'Light Rain', 'Heavy Rain', 'Persistent Rain', 'Showers',
    'Heavy Showers', 'Localised Flooding', 'Thundery Rain',
  ],
  Wind: [
    'Gusty Winds', 'Gale', 'Severe Gale', 'Storm Force',
    'Coastal Gusts', 'Hill Gusts', 'Damaging Gusts',
  ],
  Heat: [
    'Warm Spell', 'Hot Day', 'Heatwave', 'Extreme Heat',
    'Tropical Night', 'Elevated UV',
  ],
  'Daily Risks': [
    'Fog', 'Dense Fog', 'Mist', 'Hail', 'Lightning Risk',
    'Low Visibility', 'Surface Water', 'Travel Disruption',
  ],
};

/* Free-form quantitative ranges per condition.
   Rendered as labelled text inputs in the modal. */
const CONDITION_RANGES = {
  Snow:          [{ key: 'snow_accumulation_cm', label: 'Accumulation', unit: 'cm', placeholder: 'e.g. 2–5' }],
  Ice:           [{ key: 'ice_temp_c',           label: 'Temp Range',   unit: '°C', placeholder: 'e.g. -3 to 1' }],
  Thunderstorms: [{ key: 'storm_rain_mm_hr',     label: 'Rain Rate',    unit: 'mm/hr', placeholder: 'e.g. 20–40' }],
  Rain:          [{ key: 'rain_total_mm',        label: 'Rain Total',   unit: 'mm', placeholder: 'e.g. 15–30' }],
  Wind:          [{ key: 'wind_gust_mph',        label: 'Gusts',        unit: 'mph', placeholder: 'e.g. 45–60' }],
  Heat:          [{ key: 'temp_range_c',         label: 'Temp Range',   unit: '°C', placeholder: 'e.g. 30–34' }],
  'Daily Risks': [{ key: 'visibility_m',         label: 'Visibility',   unit: 'm',  placeholder: 'e.g. <100' }],
};

/* Greatly expanded text-colour palette for the editor */
const TEXT_COLOURS = [
  { label: 'White',       value: '#f8fafc' },
  { label: 'Silver',      value: '#cbd5e1' },
  { label: 'Slate',       value: '#94a3b8' },
  { label: 'Graphite',    value: '#64748b' },
  { label: 'Black',       value: '#0f172a' },
  { label: 'Sky',         value: '#38bdf8' },
  { label: 'Cyan',        value: '#22d3ee' },
  { label: 'Azure',       value: '#0ea5e9' },
  { label: 'Blue',        value: '#3b82f6' },
  { label: 'Indigo',      value: '#6366f1' },
  { label: 'Violet',      value: '#8b5cf6' },
  { label: 'Purple',      value: '#a855f7' },
  { label: 'Fuchsia',     value: '#d946ef' },
  { label: 'Pink',        value: '#ec4899' },
  { label: 'Rose',        value: '#f43f5e' },
  { label: 'Red',         value: '#ef4444' },
  { label: 'Crimson',     value: '#dc2626' },
  { label: 'Orange',      value: '#f97316' },
  { label: 'Amber',       value: '#f59e0b' },
  { label: 'Gold',        value: '#fbbf24' },
  { label: 'Yellow',      value: '#facc15' },
  { label: 'Lime',        value: '#84cc16' },
  { label: 'Green',       value: '#22c55e' },
  { label: 'Emerald',     value: '#10b981' },
  { label: 'Dark Green',  value: '#15803d' },
  { label: 'Teal',        value: '#14b8a6' },
  { label: 'Mint',        value: '#5eead4' },
  { label: 'Brown',       value: '#92400e' },
  { label: 'Sand',        value: '#d6c39a' },
];

/* ─────────────────────────────────────────────
   RICH TEXT EDITOR
───────────────────────────────────────────── */
function RichTextEditor({ value, onChange, placeholder, rows = 3 }) {
  const editorRef = useRef(null);
  const [showColours, setShowColours] = useState(false);

  // Sync contentEditable with outer value on first mount only
  const initialized = useRef(false);
  React.useEffect(() => {
    if (!initialized.current && editorRef.current) {
      editorRef.current.innerHTML = value || '';
      initialized.current = true;
    }
  }, []);

  const exec = (cmd, val = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    onChange(normalizeHtml(editorRef.current.innerHTML));
  };

  const applyColour = (colour) => {
    exec('foreColor', colour);
    setShowColours(false);
  };

  // Normalize contentEditable HTML: convert block-level <div>/<p> wrappers
  // that browsers insert for newlines into <br> tags instead.
  const normalizeHtml = (html) => {
    // Replace <div>content</div> and <p>content</p> with content<br>
    // but avoid double-br on empty divs (which become just <br>)
    return html
      .replace(/<div><br\s*\/?><\/div>/gi, '<br>')
      .replace(/<div>(.*?)<\/div>/gi, (_, inner) => inner + '<br>')
      .replace(/<p><br\s*\/?><\/p>/gi, '<br>')
      .replace(/<p>(.*?)<\/p>/gi, (_, inner) => inner + '<br>')
      // strip trailing lone <br> at end
      .replace(/(<br\s*\/?>)+$/i, '');
  };

  const handleInput = () => {
    onChange(normalizeHtml(editorRef.current.innerHTML));
  };

  // Strip all formatting on paste — insert only the raw plain text. Without
  // this, pasting from Word/Docs/web injects background colours, font spans and
  // other inline styles that bleed into the rendered description.
  const handlePaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
    onChange(normalizeHtml(editorRef.current.innerHTML));
  };

  // Force browser to insert <br> on Enter instead of <div>
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.execCommand('insertLineBreak');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '5px 8px',
        background: 'rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderBottom: 'none',
        borderRadius: '10px 10px 0 0',
      }}>
        <ToolbarBtn onClick={() => exec('bold')} title="Bold"><Bold size={11} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec('italic')} title="Italic"><Italic size={11} /></ToolbarBtn>
        <div style={{ position: 'relative' }}>
          <ToolbarBtn onClick={() => setShowColours(v => !v)} title="Colour">
            <Palette size={11} />
          </ToolbarBtn>
          {showColours && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 100, marginTop: 4,
              background: 'var(--bg-elevated, #0d1829)', border: '1px solid var(--border, rgba(255,255,255,0.12))',
              borderRadius: 10, padding: '8px 9px',
              display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6,
              width: 196,
              boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            }}>
              {TEXT_COLOURS.map(c => (
                <button
                  key={c.value}
                  onMouseDown={e => { e.preventDefault(); applyColour(c.value); }}
                  title={c.label}
                  style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: c.value, border: '2px solid rgba(255,255,255,0.15)',
                    cursor: 'pointer', flexShrink: 0,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        data-placeholder={placeholder}
        style={{
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '0 0 10px 10px',
          color: '#e2e8f0',
          fontSize: 13,
          padding: '8px 12px',
          minHeight: rows * 22,
          outline: 'none',
          lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      />
      <style>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: rgba(148,163,184,0.4);
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

function ToolbarBtn({ onClick, children, title }) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      title={title}
      style={{
        width: 24, height: 24, borderRadius: 6,
        background: 'transparent', border: '1px solid transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', color: '#64748b', transition: 'all 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#94a3b8'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748b'; }}
    >
      {children}
    </button>
  );
}

/* ─────────────────────────────────────────────
   RICH TEXT RENDERER: the description cleaned of whatever page it was pasted from (lib/cleanHtml)
───────────────────────────────────────────── */
function RichText({ html, style = {} }) {
  if (!html) return null;
  return (
    <div
      dangerouslySetInnerHTML={{ __html: cleanHtml(html) }}
      style={{ lineHeight: 1.7, display: 'inline', ...style }}
    />
  );
}

/* ─────────────────────────────────────────────
   GRAPHICS ON THE HOME PAGE — liquid glass
   The newest graphic in force gets the big pane: the graphic on one side (kept in view while
   the details scroll), everything about it on the other, stacked on a phone. Any others sit
   in a rail underneath and swap into the big pane when tapped. Every colour comes from the
   home page's glass tokens (--glass-*, --ink-*), so it follows the light and dark themes like
   the rest of the page. Images are web-sized copies (lib/sizedImage); the full-size upload
   only loads in the viewer.
───────────────────────────────────────────── */
const FG_CSS = `
.fg-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.fg-head-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.fg-btn { display: inline-flex; align-items: center; gap: 7px; min-height: 38px; padding: 0 14px; border-radius: 12px; cursor: pointer; font: inherit; font-size: 0.82rem; font-weight: 600; letter-spacing: -0.01em; text-decoration: none; white-space: nowrap; background: var(--glass-fill); border: 1px solid var(--glass-hairline); color: var(--ink-2); -webkit-backdrop-filter: blur(16px) saturate(160%); backdrop-filter: blur(16px) saturate(160%); transition: background .15s, color .15s; }
.fg-btn:hover { background: var(--glass-fill-strong); color: var(--ink-1); }
.fg-btn.is-primary { background: var(--ink-1); color: var(--page-bg); border-color: transparent; }
.fg-btn.is-primary:hover { opacity: .9; color: var(--page-bg); }
.fg-count { font-size: .76rem; font-weight: 700; color: var(--ink-2); padding: 6px 11px; border-radius: 99px; background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.fg-count-sm { font-size: .7rem; padding: 1px 7px; border-radius: 99px; background: var(--glass-fill-strong); }
.fg-feature { display: grid; grid-template-columns: minmax(0, 1fr); }
.fg-media { position: relative; padding: clamp(10px, 1.8vw, 16px); }
@media (min-width: 900px) {
  .fg-feature { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .fg-media { position: sticky; top: 72px; align-self: start; }
  .fg-body { padding-left: 6px !important; }
}
.fg-media-btn { position: relative; display: block; width: 100%; padding: 0; border: 0; background: none; cursor: zoom-in; }
.fg-img { display: block; width: 100%; height: auto; max-height: min(80vh, 820px); object-fit: contain; border-radius: 18px; background: rgba(0,0,0,.16); box-shadow: inset 0 1px 0 var(--glass-highlight), 0 18px 40px -16px rgba(0,0,0,.55); }
.fg-zoom { position: absolute; right: 12px; bottom: 12px; display: inline-flex; gap: 6px; align-items: center; padding: 7px 12px; border-radius: 99px; font-size: .76rem; font-weight: 600; color: #fff; background: rgba(10,16,28,.5); border: 1px solid rgba(255,255,255,.22); -webkit-backdrop-filter: blur(14px) saturate(160%); backdrop-filter: blur(14px) saturate(160%); pointer-events: none; }
.fg-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; cursor: pointer; color: #fff; background: rgba(10,16,28,.5); border: 1px solid rgba(255,255,255,.22); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
.fg-icon:hover { background: rgba(10,16,28,.72); }
.fg-body { display: flex; flex-direction: column; gap: 14px; min-width: 0; padding: clamp(16px, 2.6vw, 28px); }
.fg-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.fg-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 99px; font-size: .78rem; font-weight: 600; color: var(--ink-1); background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); white-space: nowrap; }
.fg-chip i { width: 8px; height: 8px; border-radius: 99px; flex-shrink: 0; }
.fg-risks { gap: 6px !important; }
.fg-risks > span { font-size: .76rem !important; padding: 4px 4px 4px 11px !important; }
.fg-risks > span:not([title]) { padding-right: 11px !important; }
.fg-risks > span > span { padding: 1px 8px !important; }
.fg-title { margin: 0; font-size: clamp(1.3rem, 2.8vw, 1.85rem); font-weight: 700; letter-spacing: -0.025em; line-height: 1.15; color: var(--ink-1); text-wrap: balance; }
.fg-times { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.fg-time { padding: 10px 12px; border-radius: 14px; background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.fg-time span { display: block; font-size: .66rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
.fg-time b { display: block; margin-top: 2px; font-size: .92rem; font-weight: 650; color: var(--ink-1); }
.fg-desc { font-size: .96rem; line-height: 1.68; color: var(--ink-2); max-height: 11.5em; overflow: hidden; -webkit-mask-image: linear-gradient(180deg, #000 68%, transparent); mask-image: linear-gradient(180deg, #000 68%, transparent); }
.fg-desc.is-open { max-height: none; -webkit-mask-image: none; mask-image: none; }
.fg-more { align-self: flex-start; margin-top: -6px; padding: 0; border: 0; background: none; color: var(--accent-uk); font: inherit; font-size: .88rem; font-weight: 650; cursor: pointer; }
.fg-locs { display: flex; gap: 8px; align-items: flex-start; font-size: .88rem; line-height: 1.5; color: var(--ink-2); }
.fg-locs svg { flex-shrink: 0; margin-top: 3px; color: var(--ink-3); }
.fg-note { padding: 10px 12px; border-radius: 14px; background: var(--tint-sky); border: 1px solid var(--glass-hairline); font-size: .88rem; line-height: 1.5; color: var(--ink-1); }
.fg-note b { display: block; margin-bottom: 2px; font-size: .66rem; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
.fg-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
.fg-dot { width: 7px; height: 7px; border-radius: 99px; background: #38bdf8; }
.fg-rail { display: flex; gap: 12px; overflow-x: auto; scroll-snap-type: x proximity; padding: 14px 2px 8px; scrollbar-width: none; }
.fg-rail::-webkit-scrollbar { display: none; }
.fg-mini { flex: 0 0 auto; width: 240px; display: flex; flex-direction: column; padding: 8px; text-align: left; font: inherit; cursor: pointer; scroll-snap-align: start; }
.fg-mini.is-on { box-shadow: var(--glass-shadow), inset 0 0 0 2px var(--accent-uk); }
.fg-mini-img img, .fg-mini-img .fg-noimg { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; object-position: top; border-radius: 16px; }
.fg-mini-body { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 10px 6px 4px; }
.fg-mini-title { font-size: .9rem; font-weight: 650; line-height: 1.3; color: var(--ink-1); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.fg-mini-time { font-size: .76rem; color: var(--ink-3); }
.fg-noimg { aspect-ratio: 4 / 3; display: grid; place-items: center; align-content: center; gap: 8px; color: var(--ink-3); border-radius: 18px; background: var(--glass-fill); }
.fg-empty { display: flex; align-items: center; gap: 14px; padding: 20px 22px; color: var(--ink-3); }
.fg-empty b { display: block; font-size: 1rem; color: var(--ink-1); }
.fg-empty span { display: block; margin-top: 2px; font-size: .88rem; color: var(--ink-2); }
`;

const condsOf = (f) => (f.weather_conditions?.length ? f.weather_conditions : f.weather_condition ? [f.weather_condition] : []);
const levelsOf = (f) => (f.impact_levels?.length ? f.impact_levels : f.impact_level ? [f.impact_level] : []);

function Chip({ dot, children }) {
  return <span className="fg-chip">{dot && <i style={{ background: dot }} />}{children}</span>;
}
function TimeTile({ label, value, tone }) {
  return <div className="fg-time"><span>{label}</span><b style={tone ? { color: tone } : undefined}>{value}</b></div>;
}
function GraphicImage({ forecast, widths, sizes, className, eager }) {
  const url = forecast.image_url;
  if (!url) return <div className="fg-noimg"><CloudSun size={32} /><span>No graphic</span></div>;
  return (
    <img src={sized(url, widths[widths.length - 1])} srcSet={sizedSet(url, widths)} sizes={sizes} alt={forecast.title || 'Forecast graphic'}
      className={className} loading={eager ? 'eager' : 'lazy'} decoding="async" />
  );
}

function FeaturedGraphic({ forecast, isOwner, onEdit, onArchive, onFurtherInfo, onUpdateImage, onOpen }) {
  const [more, setMore] = useState(false);
  const issuedAt = formatBST(forecast.created_date);
  const expiresAt = formatExpiryBST(forecast.expires_at);
  const inForceAt = formatBST(forecast.in_force_from);
  const wasEdited = forecast.updated_date && forecast.created_date
    && new Date(forecast.updated_date).getTime() - new Date(forecast.created_date).getTime() > 5000;
  const lastUpdatedAt = wasEdited ? formatBST(forecast.updated_date) : null;
  const hasDetails = forecast.impact_level || forecast.locations_impacted?.length > 0 || forecast.in_force_from;
  const expiringSoon = forecast.expires_at && !isPast(new Date(forecast.expires_at))
    && new Date(forecast.expires_at) - Date.now() < 3 * 60 * 60 * 1000;
  const subtypes = forecast.condition_subtypes || [];
  const longText = plainText(forecast.description).length > 380;
  return (
    <motion.article className="lg-pane fg-feature" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
      <div className="fg-media">
        <button type="button" className="fg-media-btn" onClick={() => forecast.image_url && onOpen(forecast)} aria-label="View the graphic full size">
          <GraphicImage forecast={forecast} widths={[480, 800, 1200, 1600]} sizes="(min-width: 900px) 540px, 100vw" className="fg-img" eager />
          {forecast.image_url && <span className="fg-zoom"><Maximize2 size={13} />Full size</span>}
        </button>
      </div>

      <div className="fg-body">
        <div className="fg-chips">
          {condsOf(forecast).map((c) => <Chip key={c} dot={(CONDITION_CONFIG[c] || DEFAULT_CFG).accent}>{c}</Chip>)}
          {levelsOf(forecast).map((l) => IMPACT_CONFIG[l] && <Chip key={l} dot={IMPACT_CONFIG[l].dot}>{l}</Chip>)}
          {forecast.forecast_update_label && <Chip dot={forecast.is_initial_forecast ? '#38bdf8' : '#f59e0b'}>{forecast.forecast_update_label}</Chip>}
          {expiringSoon && <Chip dot="#ef4444">Expiring soon</Chip>}
        </div>

        <h3 className="fg-title">{forecast.title || 'Forecast'}</h3>

        <div className="fg-times">
          {inForceAt && <TimeTile label="In force" value={inForceAt} />}
          {issuedAt && <TimeTile label="Issued" value={issuedAt} />}
          {expiresAt && <TimeTile label="Expires" value={expiresAt} tone={isPast(new Date(forecast.expires_at)) ? '#f87171' : undefined} />}
          {lastUpdatedAt && <TimeTile label="Updated" value={lastUpdatedAt} />}
        </div>

        <ThunderstormRisks data={forecast.thunderstorm_data} className="fg-risks" />

        {subtypes.length > 0 && <div className="fg-chips">{subtypes.map((s) => <Chip key={s}>{s}</Chip>)}</div>}

        {forecast.description && (
          <>
            <div className={`fg-desc${more || !longText ? ' is-open' : ''}`}><RichText html={forecast.description} /></div>
            {longText && <button type="button" className="fg-more" onClick={() => setMore((m) => !m)}>{more ? 'Show less' : 'Read more'}</button>}
          </>
        )}

        {forecast.locations_impacted?.length > 0 && (
          <div className="fg-locs"><MapPin size={14} /><span>{forecast.locations_impacted.join(', ')}</span></div>
        )}

        {forecast.update_reason && lastUpdatedAt && (
          <div className="fg-note"><b>What changed</b>{forecast.update_reason}</div>
        )}

        <div className="fg-actions">
          <button type="button" className="fg-btn is-primary" onClick={() => onFurtherInfo(forecast)}>
            Further info{hasDetails && <i className="fg-dot" />}<ChevronRight size={14} />
          </button>
          {forecast.image_url && <button type="button" className="fg-btn" onClick={() => onOpen(forecast)}><Maximize2 size={14} />View full size</button>}
          {/* the owner's tools sit with the other buttons, not over the graphic */}
          {isOwner && <button type="button" className="fg-btn" onClick={() => onEdit(forecast)}><Edit2 size={14} />Edit</button>}
          {isOwner && (
            <label className="fg-btn" title="Replace the graphic's image">
              <Upload size={14} />Replace image
              <input type="file" style={{ display: 'none' }} accept="image/*" onChange={(e) => onUpdateImage(e, forecast)} />
            </label>
          )}
          {isOwner && <button type="button" className="fg-btn" onClick={() => onArchive(forecast.id)}><Archive size={14} />Archive</button>}
        </div>
      </div>
    </motion.article>
  );
}

function MiniGraphic({ forecast, active, onSelect }) {
  const cond = condsOf(forecast)[0];
  return (
    <button type="button" className={`lg-pane lg-lift fg-mini${active ? ' is-on' : ''}`} onClick={() => onSelect(forecast.id)} aria-pressed={active} role="listitem">
      <span className="fg-mini-img"><GraphicImage forecast={forecast} widths={[480]} sizes="240px" /></span>
      <span className="fg-mini-body">
        {cond && <Chip dot={(CONDITION_CONFIG[cond] || DEFAULT_CFG).accent}>{cond}</Chip>}
        <span className="fg-mini-title">{forecast.title || 'Forecast'}</span>
        {forecast.created_date && <span className="fg-mini-time">Issued {formatBST(forecast.created_date)}</span>}
      </span>
    </button>
  );
}

/* ─────────────────────────────────────────────
   ADD / EDIT MODAL (shared)
───────────────────────────────────────────── */
const EMPTY_GRAPHIC = {
  title: '', image_url: '', description: '',
  weather_condition: '', weather_conditions: [],
  condition_subtypes: [], condition_ranges: {},
  expires_at: '', in_force_from: '',
  impact_level: '', impact_levels: [],
  locations_impacted: [], impact_drawing: '', thunderstorm_data: {},
};

/* ─────────────────────────────────────────────
   LOCATION ENTRY WITH RISK LEVELS (modal)
───────────────────────────────────────────── */
const MODAL_RISK_LEVELS = ['None', 'Very Low', 'Low', 'Marginal', 'Slight', 'Moderate', 'High', 'Severe'];
const MODAL_RISK_COLORS = {
  None: '#64748b', 'Very Low': '#86efac', Low: '#bbf7d0', Marginal: '#fde047',
  Slight: '#fdba74', Moderate: '#fca5a5', High: '#d8b4fe', Severe: '#f8fafc',
};

function ModalLocationEntry({ loc, onRemove, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.03)', padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <MapPin size={10} style={{ color: 'rgba(148,163,184,0.4)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: '#e2e8f0', flex: 1 }}>{loc.name}</span>
        <button type="button" onClick={() => setOpen(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', cursor: 'pointer', color: 'rgba(148,163,184,0.6)', fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Risk <ChevronDown size={9} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>
        <button type="button" onClick={onRemove}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'rgba(148,163,184,0.4)', display: 'flex', lineHeight: 1 }}
          onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(148,163,184,0.4)'}
        ><X size={10} /></button>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(148,163,184,0.5)', marginBottom: 4 }}>Overall Risk</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {MODAL_RISK_LEVELS.map(level => (
                <button key={level} type="button"
                  onClick={() => onChange({ ...loc, overall_risk: level === 'None' ? null : level })}
                  style={{
                    padding: '2px 8px', borderRadius: 999, fontSize: 9, fontFamily: 'monospace', cursor: 'pointer',
                    background: loc.overall_risk === level ? `${MODAL_RISK_COLORS[level]}22` : 'transparent',
                    border: `1px solid ${loc.overall_risk === level ? MODAL_RISK_COLORS[level] : 'rgba(255,255,255,0.1)'}`,
                    color: loc.overall_risk === level ? MODAL_RISK_COLORS[level] : 'rgba(148,163,184,0.5)',
                  }}>{level}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#86efac', marginBottom: 4 }}>Lowest Risk</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {MODAL_RISK_LEVELS.filter(l => l !== 'None').map(level => (
                  <button key={level} type="button"
                    onClick={() => onChange({ ...loc, lowest_risk: loc.lowest_risk === level ? null : level })}
                    style={{
                      padding: '2px 7px', borderRadius: 999, fontSize: 9, fontFamily: 'monospace', cursor: 'pointer',
                      background: loc.lowest_risk === level ? `${MODAL_RISK_COLORS[level]}22` : 'transparent',
                      border: `1px solid ${loc.lowest_risk === level ? MODAL_RISK_COLORS[level] : 'rgba(255,255,255,0.09)'}`,
                      color: loc.lowest_risk === level ? MODAL_RISK_COLORS[level] : 'rgba(148,163,184,0.4)',
                    }}>{level}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#fca5a5', marginBottom: 4 }}>Highest Risk</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {MODAL_RISK_LEVELS.filter(l => l !== 'None').map(level => (
                  <button key={level} type="button"
                    onClick={() => onChange({ ...loc, highest_risk: loc.highest_risk === level ? null : level })}
                    style={{
                      padding: '2px 7px', borderRadius: 999, fontSize: 9, fontFamily: 'monospace', cursor: 'pointer',
                      background: loc.highest_risk === level ? `${MODAL_RISK_COLORS[level]}22` : 'transparent',
                      border: `1px solid ${loc.highest_risk === level ? MODAL_RISK_COLORS[level] : 'rgba(255,255,255,0.09)'}`,
                      color: loc.highest_risk === level ? MODAL_RISK_COLORS[level] : 'rgba(148,163,184,0.4)',
                    }}>{level}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ForecastModal({ mode = 'add', initial = null, onClose, onSave, uploading, onUpload, existingForecasts = [], saving = false, error = '' }) {
  const normalizeLocations = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(l => typeof l === 'string' ? { name: l, overall_risk: null, highest_risk: null, lowest_risk: null } : l);
    return [];
  };

  const [form, setForm] = useState(() => {
    if (mode === 'edit' && initial) {
      return {
        title:              initial.title || '',
        image_url:          initial.image_url || '',
        description:        initial.description || '',
        weather_condition:  initial.weather_condition || '',
        weather_conditions: initial.weather_conditions || [],
        condition_subtypes: initial.condition_subtypes || [],
        condition_ranges:   initial.condition_ranges || {},
        expires_at:         initial.expires_at ? initial.expires_at.slice(0, 16) : '',
        in_force_from:      initial.in_force_from ? initial.in_force_from.slice(0, 16) : '',
        impact_level:       initial.impact_level || '',
        impact_levels:      initial.impact_levels || [],
        locations_impacted: normalizeLocations(initial.locations_impacted),
        impact_drawing:     initial.impact_drawing || '',
        thunderstorm_data:  initial.thunderstorm_data || {},
        update_reason:      '',
        update_label:       '',
        is_initial_forecast: initial.is_initial_forecast ?? false,
        is_continuation:    false,
        parent_graphic_id:  null,
      };
    }
    return { ...EMPTY_GRAPHIC, update_reason: '', update_label: '', is_initial_forecast: false, is_continuation: false, parent_graphic_id: null, locations_impacted: [] };
  });

  const [locationInput, setLocationInput] = useState('');
  const set = (key, val) => setForm(p => ({ ...p, [key]: val }));

  const toggleArr = (key, val) => setForm(p => ({
    ...p,
    [key]: p[key].includes(val) ? p[key].filter(x => x !== val) : [...p[key], val],
  }));

  // When a weather condition is removed, also drop its subtypes/ranges
  const toggleCondition = (c) => setForm(p => {
    const has = p.weather_conditions.includes(c);
    const nextConds = has ? p.weather_conditions.filter(x => x !== c) : [...p.weather_conditions, c];
    let nextSubtypes = p.condition_subtypes;
    let nextRanges = { ...p.condition_ranges };
    if (has) {
      const removedSubs = new Set(CONDITION_SUBTYPES[c] || []);
      nextSubtypes = p.condition_subtypes.filter(s => !removedSubs.has(s));
      for (const r of (CONDITION_RANGES[c] || [])) delete nextRanges[r.key];
    }
    return { ...p, weather_conditions: nextConds, condition_subtypes: nextSubtypes, condition_ranges: nextRanges };
  });

  const setRange = (key, val) => setForm(p => ({
    ...p, condition_ranges: { ...p.condition_ranges, [key]: val },
  }));

  const addLocation = () => {
    const v = locationInput.trim();
    if (v && !form.locations_impacted.some(l => (typeof l === 'string' ? l : l.name) === v)) {
      set('locations_impacted', [...form.locations_impacted, { name: v, overall_risk: null, highest_risk: null, lowest_risk: null }]);
      setLocationInput('');
    }
  };

  const inputStyle = {
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 10, color: '#e2e8f0', fontSize: 13,
    padding: '8px 12px', width: '100%', fontFamily: 'inherit',
    outline: 'none', transition: 'border-color 0.2s',
  };

  const isEdit = mode === 'edit';

  // Conditions currently selected that expose subtypes/ranges
  const activeConditionsWithExtras = form.weather_conditions.filter(
    c => (CONDITION_SUBTYPES[c]?.length || CONDITION_RANGES[c]?.length)
  );

  // Snapshot of the untouched form, so a stray backdrop click can't silently
  // bin a part-filled graphic.
  const [pristine] = useState(() => JSON.stringify(form));
  const isDirty = JSON.stringify(form) !== pristine;

  const requestClose = () => {
    if (isDirty && !window.confirm('Discard this graphic? Anything you have entered will be lost.')) return;
    onClose();
  };

  // onClose is a fresh arrow on every parent render, so keep it in a ref and
  // run this effect on mount/unmount only — otherwise the scroll lock would be
  // torn down and re-applied on each keystroke.
  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Title is advertised as required, so enforce it rather than quietly saving
  // the graphic as "Forecast".
  const missing = !form.title.trim()
    ? 'Give the graphic a title'
    : isEdit
      ? (!form.update_label?.trim() ? 'Add an update label' : '')
      : (!form.image_url ? 'Upload a graphic image' : '');
  const canSave = !missing && !saving && !uploading;

  // Rendered through a portal so the overlay is always positioned against the
  // viewport, whatever filters or transforms the page wrapper happens to carry.
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={requestClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 740,
          maxHeight: '90vh', overflowY: 'auto',
          background: '#08101e',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 20,
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
        }}
      >

        <div style={{ padding: '16px 24px 32px' }}>
          {/* Modal header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
                {isEdit ? 'Edit Forecast Graphic' : 'New Forecast Graphic'}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'rgba(148,163,184,0.6)', fontFamily: 'monospace' }}>
                {isEdit ? 'Update the details below' : 'Fill in the details below'}
              </p>
            </div>
            <button
              onClick={requestClose}
              style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b' }}
              onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
              onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
            >
              <X size={14} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* LEFT */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

              <FormField label="Title *">
                <input
                  style={inputStyle} placeholder="e.g. South England Rain Warning"
                  value={form.title} onChange={e => set('title', e.target.value)}
                  onFocus={e => e.target.style.borderColor = 'rgba(148,163,184,0.3)'}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.09)'}
                />
              </FormField>

              <FormField label="Weather Conditions" hint="select all that apply">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {CONDITIONS.map(c => {
                    const cfg = CONDITION_CONFIG[c];
                    const sel = form.weather_conditions.includes(c);
                    return (
                      <button key={c} type="button" onClick={() => toggleCondition(c)}
                        style={{
                          padding: '4px 12px', borderRadius: 999, fontSize: 11, fontFamily: 'monospace',
                          letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
                          background: sel ? cfg.dim : 'transparent',
                          border: `1px solid ${sel ? cfg.border : 'rgba(255,255,255,0.1)'}`,
                          color: sel ? cfg.text : 'rgba(148,163,184,0.5)',
                          transform: sel ? 'scale(1.04)' : 'scale(1)',
                          transition: 'all 0.18s',
                        }}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </FormField>

              {/* Per-condition sub-types + ranges */}
              {activeConditionsWithExtras.map(c => {
                const cfg = CONDITION_CONFIG[c] || DEFAULT_CFG;
                const subs = CONDITION_SUBTYPES[c] || [];
                const ranges = CONDITION_RANGES[c] || [];
                return (
                  <div key={c} style={{
                    borderRadius: 12, padding: '12px 13px',
                    background: cfg.dim, border: `1px solid ${cfg.border}`,
                    display: 'flex', flexDirection: 'column', gap: 12,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <cfg.Icon size={13} style={{ color: cfg.accent }} />
                      <span style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: cfg.text }}>
                        {c} — options
                      </span>
                    </div>

                    {subs.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {subs.map(s => {
                          const sel = form.condition_subtypes.includes(s);
                          return (
                            <button key={s} type="button" onClick={() => toggleArr('condition_subtypes', s)}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                padding: '3px 10px', borderRadius: 999, fontSize: 10,
                                fontFamily: 'monospace', letterSpacing: '0.04em', cursor: 'pointer',
                                background: sel ? cfg.dim : 'rgba(255,255,255,0.03)',
                                border: `1px solid ${sel ? cfg.border : 'rgba(255,255,255,0.08)'}`,
                                color: sel ? cfg.text : 'rgba(148,163,184,0.55)',
                                transition: 'all 0.15s',
                              }}
                            >
                              {sel && <Check size={9} />}
                              {s}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {ranges.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: ranges.length > 1 ? '1fr 1fr' : '1fr', gap: 8 }}>
                        {ranges.map(r => (
                          <div key={r.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <label style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(148,163,184,0.5)' }}>
                              {r.label} <span style={{ color: cfg.accent }}>({r.unit})</span>
                            </label>
                            <input
                              style={{ ...inputStyle, fontSize: 12, padding: '6px 10px' }}
                              placeholder={r.placeholder}
                              value={form.condition_ranges[r.key] || ''}
                              onChange={e => setRange(r.key, e.target.value)}
                              onFocus={e => e.target.style.borderColor = cfg.border}
                              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.09)'}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              <FormField label="Description">
                <RichTextEditor
                  value={form.description}
                  onChange={v => set('description', v)}
                  placeholder="Brief description of the forecast…"
                  rows={4}
                />
              </FormField>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <FormField label="In Force From">
                  <input type="datetime-local" style={{ ...inputStyle, fontSize: 11 }}
                    value={form.in_force_from} onChange={e => set('in_force_from', e.target.value)} />
                </FormField>
                <FormField label="Expires At">
                  <input type="datetime-local" style={{ ...inputStyle, fontSize: 11 }}
                    value={form.expires_at} onChange={e => set('expires_at', e.target.value)} />
                </FormField>
              </div>

              <FormField label="Risk Level" hint="select all that apply">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {IMPACT_LEVELS.map(level => {
                    const cfg = IMPACT_CONFIG[level];
                    const sel = form.impact_levels.includes(level);
                    const isSevere = level === 'Severe';
                    return (
                      <button key={level} type="button" title={level} onClick={() => toggleArr('impact_levels', level)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '5px 13px', borderRadius: 999, fontSize: 11,
                          fontFamily: 'monospace', letterSpacing: '0.06em', textTransform: 'uppercase',
                          cursor: 'pointer',
                          background: sel ? cfg.bg : 'transparent',
                          border: `1px solid ${sel ? cfg.border : (isSevere ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.1)')}`,
                          color: sel ? cfg.text : 'rgba(148,163,184,0.5)',
                          boxShadow: sel && isSevere ? '0 0 0 1px #000' : 'none',
                          transition: 'all 0.18s',
                        }}
                      >
                        {sel && <Check size={10} />}
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.dot, border: isSevere ? '1px solid rgba(255,255,255,0.4)' : 'none', flexShrink: 0 }} />
                        {/* The studio's own wording, so what is picked here is
                            what gets drawn on the graphic — a band called
                            "Marginal" internally publishes as SLGT. The full
                            name stays in the tooltip. */}
                        {GRAPHIC_LEVEL_LABEL[level]?.short || level}
                        {GRAPHIC_LEVEL_LABEL[level]?.range && (
                          <span style={{ fontSize: 9, opacity: 0.65, letterSpacing: 0 }}>
                            {GRAPHIC_LEVEL_LABEL[level].range}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </FormField>

              {form.weather_conditions.includes('Thunderstorms') && (
                <ThunderstormPanel
                  data={form.thunderstorm_data || {}}
                  onChange={td => set('thunderstorm_data', td)} />
              )}

              {/* Update fields — edit mode only */}
              {isEdit && (
                <>
                  <FormField label="Update Name *" hint="e.g. Update 1, Update 2, Final Update">
                    <input
                      style={inputStyle}
                      placeholder="e.g. Update 1"
                      value={form.update_label || ''}
                      onChange={e => set('update_label', e.target.value)}
                      onFocus={e => e.target.style.borderColor = 'rgba(96,165,250,0.5)'}
                      onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.09)'}
                    />
                    <p style={{ margin: '4px 0 0', fontSize: 10, color: 'rgba(96,165,250,0.6)', fontFamily: 'monospace' }}>
                      The original forecast will be preserved as "Initial Forecast". This creates a new record marked with your update name.
                    </p>
                  </FormField>
                  <FormField label="What changed? (optional)">
                    <input
                      style={inputStyle}
                      placeholder="Describe the changes…"
                      value={form.update_reason || ''}
                      onChange={e => set('update_reason', e.target.value)}
                      onFocus={e => e.target.style.borderColor = 'rgba(148,163,184,0.3)'}
                      onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.09)'}
                    />
                  </FormField>
                </>
              )}
            </div>

            {/* RIGHT */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Image upload */}
              {form.image_url ? (
                <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: 'rgba(0,0,0,0.3)' }}>
                  <img src={form.image_url} alt="Preview" style={{ width: '100%', maxHeight: 200, objectFit: 'contain', display: 'block' }} />
                  <button
                    onClick={() => set('image_url', '')}
                    style={{
                      position: 'absolute', top: 8, right: 8,
                      width: 28, height: 28, borderRadius: 8,
                      background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', color: '#94a3b8',
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <label style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  height: 180, borderRadius: 14, cursor: 'pointer',
                  border: '1.5px dashed rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.02)',
                  transition: 'border-color 0.2s, background 0.2s',
                  gap: 8,
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(148,163,184,0.3)'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                >
                  {uploading ? (
                    <Loader2 size={24} style={{ color: '#60a5fa', animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <>
                      <Upload size={22} style={{ color: 'rgba(148,163,184,0.4)' }} />
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(148,163,184,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        Upload graphic
                      </span>
                    </>
                  )}
                  <input type="file" style={{ display: 'none' }} accept="image/*"
                    onChange={async e => {
                      const url = await onUpload(e, true);
                      if (url) set('image_url', url);
                    }} />
                </label>
              )}

              {/* Locations */}
              <FormField label="Locations Impacted">
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder="Add a location…"
                    value={locationInput}
                    onChange={e => setLocationInput(e.target.value)}
                    onFocus={e => e.target.style.borderColor = 'rgba(148,163,184,0.3)'}
                    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.09)'}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLocation(); } }}
                  />
                  <button type="button" onClick={addLocation}
                    style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', color: '#94a3b8', transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {form.locations_impacted.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    {form.locations_impacted.map((rawLoc) => {
                      const loc = typeof rawLoc === 'string' ? { name: rawLoc, overall_risk: null, highest_risk: null, lowest_risk: null } : rawLoc;
                      return (
                        <ModalLocationEntry
                          key={loc.name}
                          loc={loc}
                          onRemove={() => set('locations_impacted', form.locations_impacted.filter(l => (typeof l === 'string' ? l : l.name) !== loc.name))}
                          onChange={(updated) => set('locations_impacted', form.locations_impacted.map(l => (typeof l === 'string' ? l : l.name) === loc.name ? updated : l))}
                        />
                      );
                    })}
                  </div>
                )}
              </FormField>

              {/* Forecast Type */}
              <FormField label="Forecast Type">
                <div style={{
                  borderRadius: 12, padding: '12px 14px',
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)',
                  display: 'flex', flexDirection: 'column', gap: 12,
                }}>
                  {/* Initial forecast toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Flag size={13} style={{ color: '#38bdf8' }} />
                      <div>
                        <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600 }}>Initial Forecast</div>
                        <div style={{ fontSize: 10, color: 'rgba(148,163,184,0.5)', fontFamily: 'monospace' }}>First forecast for this event</div>
                      </div>
                    </div>
                    <button type="button"
                      onClick={() => setForm(p => ({ ...p, is_initial_forecast: !p.is_initial_forecast, is_continuation: p.is_initial_forecast ? p.is_continuation : false, parent_graphic_id: p.is_initial_forecast ? p.parent_graphic_id : null }))}
                      style={{
                        width: 40, height: 22, borderRadius: 11, cursor: 'pointer', transition: 'all 0.2s',
                        background: form.is_initial_forecast ? 'rgba(56,189,248,0.3)' : 'rgba(255,255,255,0.07)',
                        border: `1px solid ${form.is_initial_forecast ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.1)'}`,
                        position: 'relative', flexShrink: 0,
                      }}
                    >
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%', position: 'absolute', top: 2,
                        left: form.is_initial_forecast ? 20 : 2, transition: 'left 0.2s',
                        background: form.is_initial_forecast ? '#38bdf8' : '#475569',
                      }} />
                    </button>
                  </div>

                  {/* Continuation toggle — only when not initial */}
                  {!form.is_initial_forecast && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <RefreshCw size={13} style={{ color: '#f59e0b' }} />
                          <div>
                            <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600 }}>Continuation</div>
                            <div style={{ fontSize: 10, color: 'rgba(148,163,184,0.5)', fontFamily: 'monospace' }}>Moves selected graphic to archive</div>
                          </div>
                        </div>
                        <button type="button"
                          onClick={() => setForm(p => ({ ...p, is_continuation: !p.is_continuation, parent_graphic_id: null }))}
                          style={{
                            width: 40, height: 22, borderRadius: 11, cursor: 'pointer', transition: 'all 0.2s',
                            background: form.is_continuation ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.07)',
                            border: `1px solid ${form.is_continuation ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.1)'}`,
                            position: 'relative', flexShrink: 0,
                          }}
                        >
                          <div style={{
                            width: 16, height: 16, borderRadius: '50%', position: 'absolute', top: 2,
                            left: form.is_continuation ? 20 : 2, transition: 'left 0.2s',
                            background: form.is_continuation ? '#f59e0b' : '#475569',
                          }} />
                        </button>
                      </div>
                      {form.is_continuation && (
                        <select
                          value={form.parent_graphic_id || ''}
                          onChange={e => setForm(p => ({ ...p, parent_graphic_id: e.target.value || null }))}
                          style={{ ...inputStyle, fontSize: 12 }}
                        >
                          <option value="">— Select graphic this continues —</option>
                          {existingForecasts.filter(f => !f.is_archived && f.id !== initial?.id).map(f => (
                            <option key={f.id} value={f.id}>{f.title}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              </FormField>
            </div>
          </div>

          {/* Footer */}
          <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.06)' }}>

            {/* A failed save used to leave the dialog sitting there with no
                explanation — say what went wrong instead. */}
            {error && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12,
                padding: '9px 12px', borderRadius: 10,
                background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
                color: '#fca5a5', fontSize: 12, lineHeight: 1.45,
              }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{error}</span>
              </div>
            )}

            {missing && !error && (
              <p style={{
                margin: '0 0 12px', fontFamily: 'monospace', fontSize: 10,
                color: 'rgba(148,163,184,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                {missing} to continue
              </p>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={requestClose} disabled={saving} style={{
                flex: 1, padding: '10px 0', borderRadius: 12,
                background: 'transparent', border: '1px solid rgba(255,255,255,0.08)',
                color: '#64748b', fontSize: 12, fontFamily: 'monospace', letterSpacing: '0.06em',
                textTransform: 'uppercase', cursor: saving ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
              }}
                onMouseEnter={e => { if (!saving) e.currentTarget.style.color = '#94a3b8'; }}
                onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
              >
                Cancel
              </button>
              <button
                // Guarded as well as disabled: a double-click used to fire the
                // create mutation twice and publish two copies of the graphic.
                onClick={() => { if (canSave) onSave(form); }}
                disabled={!canSave}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 12,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  background: canSave ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${canSave ? 'rgba(96,165,250,0.35)' : 'rgba(255,255,255,0.06)'}`,
                  color: canSave ? '#93c5fd' : 'rgba(148,163,184,0.3)',
                  fontSize: 12, fontFamily: 'monospace', letterSpacing: '0.06em',
                  textTransform: 'uppercase', cursor: canSave ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s',
                }}
              >
                {saving && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
                {saving ? 'Saving…' : isEdit ? 'Publish Update' : 'Add Forecast'}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

function FormField({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(148,163,184,0.5)' }}>
        {label}
        {hint && <span style={{ marginLeft: 5, color: 'rgba(100,116,139,0.5)', textTransform: 'none', letterSpacing: 0 }}>— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────
   MAIN SECTION
───────────────────────────────────────────── */
export default function ForecastSection({ forecasts = [], isOwner }) {
  const [showAddNew, setShowAddNew] = useState(false);
  const [saveError, setSaveError] = useState('');
  // Both save handlers await before they reach the mutation, so isPending alone
  // leaves a window in which a second click would publish a duplicate.
  const [submitting, setSubmitting] = useState(false);
  const [editingForecast, setEditingForecast] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [furtherInfoForecast, setFurtherInfoForecast] = useState(null);
  const [selected, setSelected] = useState(null);           // the graphic in the big pane (default: the newest)
  const [viewing, setViewing] = useState(null);             // the graphic open full screen
  const queryClient = useQueryClient();

  const activeForecasts   = forecasts.filter(f => !f.is_archived && (!f.expires_at || !isPast(new Date(f.expires_at))));
  const archivedForecasts = forecasts.filter(f => f.is_archived || (f.expires_at && isPast(new Date(f.expires_at))));

  const featured = activeForecasts.find((f) => f.id === selected) || activeForecasts[0] || null;
  /* issued in the last day: the heading says so */
  const fresh = activeForecasts.some((f) => f.created_date && Date.now() - new Date(f.created_date).getTime() < 24 * 3600e3);

  /* mutations */
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.WeatherGraphic.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['forecasts'] }),
    onError: (e) => setSaveError(e?.message || 'Could not update the graphic. Please try again.'),
  });

  // The dialog only closes once the save has actually landed — it used to shut
  // on the edit path before the request resolved, so a failure vanished with it.
  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.WeatherGraphic.create({ ...data, is_forecast: true, published: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forecasts'] });
      setSaveError('');
      setShowAddNew(false);
      setEditingForecast(null);
    },
    onError: (e) => setSaveError(e?.message || 'Could not save the graphic. Please try again.'),
    onSettled: () => setSubmitting(false),
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => base44.entities.WeatherGraphic.update(id, { is_archived: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['forecasts'] }),
  });

  const handleImageUpload = async (e, isNew = false) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return undefined;
    setUploading(true);
    setSaveError('');
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      return file_url;
    } catch (err) {
      // A throw here used to leave `uploading` stuck true forever, with the
      // dialog spinning and no indication that anything had gone wrong.
      setSaveError(err?.message || 'The image upload failed. Please try again.');
      return undefined;
    } finally {
      setUploading(false);
      // Clear the picker so the same file can be chosen again after a failure.
      input.value = '';
    }
  };

  const handleUpdateImage = async (e, forecast) => {
    const url = await handleImageUpload(e);
    if (url) updateMutation.mutate({ id: forecast.id, data: { image_url: url } });
  };

  const handleFurtherInfoUpdate = async (data) => {
    if (!furtherInfoForecast) return;
    await base44.entities.WeatherGraphic.update(furtherInfoForecast.id, data);
    queryClient.invalidateQueries({ queryKey: ['forecasts'] });
    setFurtherInfoForecast(prev => ({ ...prev, ...data }));
  };

  const handleCreate = async (form) => {
    if (submitting || createMutation.isPending) return;
    setSubmitting(true);
    // If continuation, archive the parent graphic first
    if (form.is_continuation && form.parent_graphic_id) {
      try {
        await base44.entities.WeatherGraphic.update(form.parent_graphic_id, { is_archived: true });
      } catch (e) {
        console.warn('[ForecastSection] Could not archive parent graphic:', e?.message);
      }
    }
    createMutation.mutate({
      title: form.title || 'Forecast',
      image_url: form.image_url,
      description: form.description,
      weather_condition:  form.weather_conditions[0] ?? undefined,
      weather_conditions: form.weather_conditions.length  ? form.weather_conditions  : undefined,
      condition_subtypes: form.condition_subtypes.length ? form.condition_subtypes : undefined,
      condition_ranges:   Object.keys(form.condition_ranges || {}).length ? form.condition_ranges : undefined,
      expires_at:         form.expires_at   || undefined,
      in_force_from:      form.in_force_from || undefined,
      impact_level:       form.impact_levels.length === 1 ? form.impact_levels[0] : form.impact_levels.at(-1) ?? undefined,
      impact_levels:      form.impact_levels.length ? form.impact_levels : undefined,
      locations_impacted: form.locations_impacted.length ? form.locations_impacted : undefined,
      impact_drawing:     form.impact_drawing || undefined,
      thunderstorm_data:  form.weather_conditions.includes('Thunderstorms') && Object.keys(form.thunderstorm_data || {}).length
        ? form.thunderstorm_data : undefined,
      is_initial_forecast: form.is_initial_forecast || false,
    });
  };

  const handleEditSave = async (form) => {
    if (!editingForecast) return;
    if (submitting || createMutation.isPending) return;
    setSubmitting(true);

    const updateLabel = form.update_label?.trim() || 'Update';

    // 1. Mark the original forecast as "Initial Forecast" (preserves it in the record)
    //    Only do this the first time — if it's already been marked as initial, keep it
    try {
      const wasAlreadyLabelled = editingForecast.forecast_update_label;
      await base44.entities.WeatherGraphic.update(editingForecast.id, {
        forecast_update_label: wasAlreadyLabelled || 'Initial Forecast',
        is_archived: false, // keep visible as historical entry
        is_initial_forecast: true,
      });
    } catch (e) {
      console.warn('[ForecastSection] Could not mark original as Initial Forecast:', e?.message);
    }

    // 2. Create a new forecast record for this update
    createMutation.mutate({
      title: form.title || editingForecast.title || 'Forecast',
      image_url: form.image_url || editingForecast.image_url,
      description: form.description,
      weather_condition:  form.weather_conditions[0] ?? form.weather_condition ?? undefined,
      weather_conditions: form.weather_conditions.length ? form.weather_conditions : undefined,
      condition_subtypes: form.condition_subtypes.length ? form.condition_subtypes : undefined,
      condition_ranges:   Object.keys(form.condition_ranges || {}).length ? form.condition_ranges : undefined,
      expires_at:         form.expires_at || undefined,
      in_force_from:      form.in_force_from || undefined,
      impact_level:       form.impact_levels.length === 1 ? form.impact_levels[0] : form.impact_levels.at(-1) ?? undefined,
      impact_levels:      form.impact_levels.length ? form.impact_levels : undefined,
      locations_impacted: form.locations_impacted.length ? form.locations_impacted : undefined,
      impact_drawing:     form.impact_drawing || undefined,
      thunderstorm_data:  form.weather_conditions.includes('Thunderstorms') && Object.keys(form.thunderstorm_data || {}).length
        ? form.thunderstorm_data : undefined,
      update_reason:      form.update_reason || undefined,
      forecast_update_label: updateLabel,
      is_initial_forecast: false,
      parent_forecast_id: editingForecast.id,
    });
    // Closing is handled by createMutation.onSuccess, so a failed update keeps
    // the dialog (and the typed-in content) on screen with the reason shown.
  };

  return (
    <section className="mx-auto w-full px-4 sm:px-6" style={{ maxWidth: 1120, paddingTop: 'clamp(28px, 5vw, 56px)' }}>
      <style>{FG_CSS}</style>

      <div className="fg-head">
        <div style={{ minWidth: 0 }}>
          <p className="lg-eyebrow" style={{ margin: '0 0 7px' }}>{fresh ? 'Just issued' : activeForecasts.length ? 'In force' : 'Issued by us'}</p>
          <h2 className="lg-title" style={{ margin: 0 }}>MyWeatherUK Graphics</h2>
        </div>
        <div className="fg-head-actions">
          {activeForecasts.length > 0 && <span className="fg-count">{activeForecasts.length} active</span>}
          {isOwner && (
            <button type="button" className="fg-btn" onClick={() => setShowAddNew(true)}><Plus size={14} />Add graphic</button>
          )}
          <Link to="/MyWeatherArchive" className="fg-btn">
            <Archive size={14} />Archive
            {archivedForecasts.length > 0 && <span className="fg-count-sm">{archivedForecasts.length}</span>}
          </Link>
        </div>
      </div>

      {featured ? (
        <>
          <FeaturedGraphic
            key={featured.id}
            forecast={featured}
            isOwner={isOwner}
            onEdit={(f) => setEditingForecast(f)}
            onArchive={(id) => archiveMutation.mutate(id)}
            onFurtherInfo={setFurtherInfoForecast}
            onUpdateImage={handleUpdateImage}
            onOpen={setViewing}
          />
          {activeForecasts.length > 1 && (
            <div className="fg-rail" role="list" aria-label="Other graphics in force">
              {activeForecasts.map((f) => (
                <MiniGraphic key={f.id} forecast={f} active={f.id === featured.id} onSelect={setSelected} />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="lg-pane fg-empty">
          <CloudSun size={28} />
          <div>
            <b>No graphics in force right now</b>
            <span>New MyWeatherUK forecasts appear here, and move to the top of the page, as soon as they are issued.</span>
          </div>
        </div>
      )}

      {/* MODALS */}
      <AnimatePresence>
        {isOwner && showAddNew && (
          <ForecastModal
            mode="add"
            onClose={() => { setSaveError(''); setShowAddNew(false); }}
            onSave={handleCreate}
            uploading={uploading}
            onUpload={handleImageUpload}
            existingForecasts={activeForecasts}
            saving={createMutation.isPending || submitting}
            error={saveError}
          />
        )}
        {isOwner && editingForecast && (
          <ForecastModal
            mode="edit"
            initial={editingForecast}
            onClose={() => { setSaveError(''); setEditingForecast(null); }}
            onSave={handleEditSave}
            uploading={uploading}
            onUpload={handleImageUpload}
            existingForecasts={activeForecasts}
            saving={createMutation.isPending || submitting}
            error={saveError}
          />
        )}
      </AnimatePresence>

      {furtherInfoForecast && (
        <ForecastFurtherInfo
          forecast={furtherInfoForecast}
          isOwner={isOwner}
          onClose={() => setFurtherInfoForecast(null)}
          onUpdate={handleFurtherInfoUpdate}
        />
      )}

      {viewing && <GraphicViewer graphic={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}