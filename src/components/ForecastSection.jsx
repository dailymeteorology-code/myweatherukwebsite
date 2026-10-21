import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CloudSun, X, Upload, Loader2,
  ChevronRight, MapPin, Check, Plus, Archive,
  AlertTriangle, Zap, Wind, Droplets, Snowflake, Flame,
  Bold, Italic, Palette, Edit2, Flag, RefreshCw, ChevronDown, Maximize2,
  ImagePlus, Info, CheckCircle2, CalendarClock, Clock3, Gauge, Type, AlignLeft, Eraser,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isValid, isPast } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import ForecastFurtherInfo from './ForecastFurtherInfo';
import ThunderstormPanel from './ThunderstormPanel';
import { ThunderstormRisks, GRAPHIC_LEVEL_NAMES, GraphicLevelChoice, GraphicLevelPill, normLevel } from '@/components/graphics/GraphicMeta';
import { useTheme } from '@/components/ThemeContext';
import { sized, sizedSet } from '@/lib/sizedImage';
import { cleanHtml, plainText, TEXT_COLOURS, richTextCss } from '@/lib/cleanHtml';
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

/* the editor's text colours are TEXT_COLOURS in lib/cleanHtml, which keeps exactly those when the
   description is shown */

/* ─────────────────────────────────────────────
   RICH TEXT EDITOR (the description, in the add / edit sheet)
   Bold, italic, a colour and "clear formatting"; Enter is a line break and a paste comes in as
   plain text (anything pasted from Word or a web page used to carry its fonts and backgrounds
   into the published description). Styles: .gm-rte-* in GM_CSS.
───────────────────────────────────────────── */
function RichTextEditor({ value, onChange, placeholder }) {
  const editorRef = useRef(null);
  const barRef = useRef(null);
  const [showColours, setShowColours] = useState(false);
  const [words, setWords] = useState(() => plainText(value).split(/\s+/).filter(Boolean).length);

  // the editor owns its content after the first render (it is re-keyed to start again)
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = value || '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showColours) return undefined;
    const away = (e) => { if (!barRef.current?.contains(e.target)) setShowColours(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [showColours]);

  // Browsers wrap new lines in <div>/<p>; keep the description as text and <br>s.
  const normalizeHtml = (html) => html
    .replace(/<div><br\s*\/?><\/div>/gi, '<br>')
    .replace(/<div>(.*?)<\/div>/gi, (_, inner) => inner + '<br>')
    .replace(/<p><br\s*\/?><\/p>/gi, '<br>')
    .replace(/<p>(.*?)<\/p>/gi, (_, inner) => inner + '<br>')
    .replace(/(<br\s*\/?>)+$/i, '');

  const emit = () => {
    const el = editorRef.current;
    if (!el) return;
    onChange(normalizeHtml(el.innerHTML));
    setWords(el.innerText.split(/\s+/).filter(Boolean).length);
  };
  const exec = (cmd, val = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    emit();
  };
  const handlePaste = (e) => {
    if ([...(e.clipboardData?.files || [])].some((f) => f.type.startsWith('image/'))) return;   // an image: the sheet takes it as the graphic
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
    emit();
  };
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); document.execCommand('insertLineBreak'); }
  };
  const tool = (title, Icon, run) => (
    <button type="button" title={title} aria-label={title} onMouseDown={(e) => { e.preventDefault(); run(); }}><Icon /></button>
  );

  return (
    <div className="gm-rte">
      <div className="gm-rte-bar" ref={barRef}>
        {tool('Bold', Bold, () => exec('bold'))}
        {tool('Italic', Italic, () => exec('italic'))}
        {tool('Text colour', Palette, () => setShowColours((v) => !v))}
        <span className="gm-rte-sep" />
        {tool('Clear formatting', Eraser, () => exec('removeFormat'))}
        <span className="gm-rte-count">{words} word{words === 1 ? '' : 's'}</span>
        {showColours && (
          <div className="gm-swatches" role="menu" aria-label="Text colour">
            {TEXT_COLOURS.map((c) => (
              <button key={c.value} type="button" title={c.label} aria-label={c.label} style={{ background: c.value }}
                onMouseDown={(e) => { e.preventDefault(); exec('foreColor', c.value); setShowColours(false); }} />
            ))}
          </div>
        )}
      </div>
      <div
        ref={editorRef}
        className="gm-rte-area"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Description"
        onInput={emit}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        data-placeholder={placeholder}
      />
    </div>
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
.fg-risks > span { font-size: .76rem !important; }
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
${richTextCss('.fg-desc', 'html.light-mode', 'html:not(.light-mode)')}
`;

const condsOf = (f) => (f.weather_conditions?.length ? f.weather_conditions : f.weather_condition ? [f.weather_condition] : []);
/* the levels as the ladder names them: some older graphics stored the studio's short label ("SLGT") */
const levelsOf = (f) => [...new Set((f.impact_levels?.length ? f.impact_levels : f.impact_level ? [f.impact_level] : []).map((l) => normLevel(l) || l))];

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
          {levelsOf(forecast).map((l) => <GraphicLevelPill key={l} level={l} style={{ fontSize: '.76rem', padding: '4px 11px' }} />)}
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
          /* places can carry their own risk, so they are objects, not strings: joining them printed "[object Object]" */
          <div className="fg-locs"><MapPin size={14} /><span>{forecast.locations_impacted.map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean).join(', ')}</span></div>
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
          {/* This used to be a button called "Archive", next to the heading's "Archive" link to the
              archive page, and it archived the graphic on one tap: on 20 Oct 2026 that took the
              graphic for the next night off the home page. It now says what it does and asks. */}
          {isOwner && (
            <button type="button" className="fg-btn" onClick={() => {
              if (window.confirm(`Take "${forecast.title || 'this graphic'}" off the home page and move it to the archive?\n\nIt can be put back from the archive.`)) onArchive(forecast.id);
            }}><Archive size={14} />Move to archive</button>
          )}
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

/* The add / edit sheet's styles. Its own glass tokens, the home page's values, in a dark set and
   a light one (.is-light): it renders over whichever page opened it, so it cannot lean on that
   page's. Light and dark are different materials, as on the home page: in the dark the glass is
   white at low alpha over a deep sheet, in the light a near-opaque white with real hairlines. */
const GM_CSS = `
.gm { --gm-sheet: rgba(13,19,31,.82); --gm-card: rgba(255,255,255,.045); --gm-card-2: rgba(255,255,255,.1); --gm-field: rgba(0,0,0,.24);
  --glass-fill: rgba(255,255,255,.05); --glass-fill-strong: rgba(255,255,255,.09); --glass-hairline: rgba(255,255,255,.11); --glass-highlight: rgba(255,255,255,.14);
  --ink-1: #f2f6fc; --ink-2: #9fb0c6; --ink-3: rgba(159,176,198,.66); --gm-accent: #56b6f5; --gm-accent-ink: #04121f; --gm-danger: #f87171; --gm-warn: #fbbf24;
  --gm-scrim: rgba(2,6,14,.56); --gm-shadow: 0 1px 2px rgba(0,0,0,.35), 0 40px 90px -20px rgba(0,0,0,.75);
  position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 24px;
  background: var(--gm-scrim); -webkit-backdrop-filter: blur(10px) saturate(120%); backdrop-filter: blur(10px) saturate(120%);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', Inter, Roboto, sans-serif;
  color: var(--ink-1); -webkit-font-smoothing: antialiased; text-align: left; }
.gm.is-light { --gm-sheet: rgba(244,247,252,.88); --gm-card: rgba(255,255,255,.74); --gm-card-2: #ffffff; --gm-field: rgba(255,255,255,.95);
  --glass-fill: rgba(255,255,255,.72); --glass-fill-strong: #ffffff; --glass-hairline: rgba(15,23,42,.1); --glass-highlight: rgba(255,255,255,.95);
  --ink-1: #0b1220; --ink-2: #4a5b70; --ink-3: rgba(74,91,112,.72); --gm-accent: #1d74c4; --gm-accent-ink: #ffffff; --gm-danger: #dc2626; --gm-warn: #b45309;
  --gm-scrim: rgba(15,23,42,.3); --gm-shadow: 0 1px 2px rgba(15,23,42,.06), 0 40px 90px -24px rgba(15,23,42,.38); }
.gm *, .gm *::before, .gm *::after { box-sizing: border-box; }
.gm-sheet { position: relative; display: flex; flex-direction: column; width: min(1120px, 100%); height: min(900px, calc(100vh - 48px)); height: min(900px, calc(100dvh - 48px));
  border-radius: 28px; overflow: hidden; background: var(--gm-sheet); border: 1px solid var(--glass-hairline); box-shadow: var(--gm-shadow), inset 0 1px 0 var(--glass-highlight);
  -webkit-backdrop-filter: blur(34px) saturate(185%); backdrop-filter: blur(34px) saturate(185%); }
.gm-sheet::before { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background: radial-gradient(110% 55% at 0% -10%, rgba(86,182,245,.16), transparent 55%), radial-gradient(80% 45% at 100% 0%, rgba(167,139,250,.12), transparent 60%); }
.gm-head { position: relative; display: flex; align-items: center; gap: 12px; padding: 16px 16px 14px 20px; border-bottom: 1px solid var(--glass-hairline); }
.gm-badge { display: grid; place-items: center; width: 42px; height: 42px; flex-shrink: 0; border-radius: 14px; color: var(--gm-accent); background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); box-shadow: inset 0 1px 0 var(--glass-highlight); }
.gm-head h3 { margin: 0; font-size: 1.14rem; font-weight: 700; letter-spacing: -.02em; color: var(--ink-1); }
.gm-head p { margin: 2px 0 0; font-size: .8rem; line-height: 1.35; color: var(--ink-3); }
.gm-x { margin-left: auto; display: grid; place-items: center; width: 38px; height: 38px; flex-shrink: 0; border-radius: 13px; cursor: pointer; color: var(--ink-2); background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.gm-x:hover { color: var(--ink-1); background: var(--glass-fill-strong); }
.gm-body { position: relative; flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
  display: grid; grid-template-columns: minmax(270px, 370px) minmax(0, 1fr); gap: 18px; padding: 18px 20px 26px; align-items: start; }
.gm-side { position: sticky; top: 0; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.gm-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.gm-card { border-radius: 20px; padding: 14px 16px 16px; background: var(--gm-card); border: 1px solid var(--glass-hairline); box-shadow: inset 0 1px 0 var(--glass-highlight); }
.gm-card h4 { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: .72rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
.gm-card h4 svg { width: 15px; height: 15px; color: var(--ink-2); }
.gm-card h4 em { margin-left: auto; font-style: normal; font-weight: 600; letter-spacing: 0; text-transform: none; font-size: .8rem; color: var(--ink-2); }
.gm-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.gm-field > span:first-child { font-size: .8rem; font-weight: 600; color: var(--ink-2); }
.gm-field > span:first-child small { margin-left: 4px; font-size: .74rem; font-weight: 500; color: var(--ink-3); }
.gm-input, .gm-select { width: 100%; min-height: 42px; padding: 0 13px; border-radius: 13px; font: inherit; font-size: 15px; color: var(--ink-1); background: var(--gm-field); border: 1px solid var(--glass-hairline); outline: none; transition: border-color .15s, box-shadow .15s; }
.gm-input::placeholder { color: var(--ink-3); }
.gm-input:focus, .gm-select:focus { border-color: var(--gm-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--gm-accent) 24%, transparent); }
.gm-input.is-big { min-height: 50px; font-size: 1.06rem; font-weight: 600; }
.gm-input[type='datetime-local'] { font-size: 14px; color-scheme: dark; }
.gm.is-light .gm-input[type='datetime-local'] { color-scheme: light; }
.gm-select { appearance: none; -webkit-appearance: none; padding-right: 34px; cursor: pointer; font-size: 14px;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 17px) 52%, calc(100% - 12px) 52%; background-size: 5px 5px; background-repeat: no-repeat; }
.gm-select option { color: #0b1220; background: #fff; }
.gm-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.gm-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.gm-chip { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 0 13px 0 11px; border-radius: 99px; cursor: pointer; font: inherit; font-size: .85rem; font-weight: 600; color: var(--ink-2); background: var(--glass-fill); border: 1px solid var(--glass-hairline); transition: background .15s, color .15s, border-color .15s, box-shadow .15s; }
.gm-chip:hover { color: var(--ink-1); background: var(--glass-fill-strong); }
.gm-chip svg { width: 15px; height: 15px; flex-shrink: 0; }
.gm-chip[aria-pressed='true'] { color: var(--ink-1); background: color-mix(in srgb, var(--c, var(--gm-accent)) 20%, transparent); border-color: var(--c, var(--gm-accent)); box-shadow: 0 0 0 1px var(--c, var(--gm-accent)); }
.gm-chip.is-sm { min-height: 30px; padding: 0 11px; font-size: .79rem; font-weight: 550; }
.gm-sub { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; padding: 12px; border-radius: 16px; background: color-mix(in srgb, var(--c) 9%, transparent); border: 1px solid color-mix(in srgb, var(--c) 32%, transparent); }
.gm-sub > b { display: flex; align-items: center; gap: 7px; font-size: .8rem; font-weight: 700; color: var(--ink-1); }
.gm-sub > b svg { width: 15px; height: 15px; color: var(--c); }
.gm-quick { display: flex; flex-wrap: wrap; gap: 6px; }
.gm-quick button { min-height: 28px; padding: 0 10px; border-radius: 99px; cursor: pointer; font: inherit; font-size: .76rem; font-weight: 600; color: var(--ink-2); background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.gm-quick button:hover { color: var(--ink-1); background: var(--glass-fill-strong); }
.gm-span { display: flex; align-items: center; gap: 8px; margin: 12px 0 0; font-size: .84rem; line-height: 1.4; color: var(--ink-2); }
.gm-span svg { width: 15px; height: 15px; flex-shrink: 0; }
.gm-span.is-bad { color: var(--gm-danger); }
.gm-span.is-warn { color: var(--gm-warn); }
.gm-ladder { display: flex; flex-wrap: wrap; gap: 7px; }
.gm-hint { margin: 10px 0 0; font-size: .78rem; line-height: 1.45; color: var(--ink-3); }
.gm-drop { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; width: 100%; aspect-ratio: 9 / 13; padding: 22px; border-radius: 22px; text-align: center; cursor: pointer; font: inherit; color: var(--ink-1);
  background: var(--gm-card); border: 1.5px dashed color-mix(in srgb, var(--ink-3) 75%, transparent); transition: border-color .15s, background .15s, transform .15s; }
.gm-drop:hover, .gm-drop.is-over { border-color: var(--gm-accent); background: color-mix(in srgb, var(--gm-accent) 9%, var(--gm-card)); }
.gm-drop.is-over { transform: scale(1.01); }
.gm-drop-icon { display: grid; place-items: center; width: 58px; height: 58px; border-radius: 19px; color: var(--gm-accent); background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); box-shadow: inset 0 1px 0 var(--glass-highlight); }
.gm-drop b { font-size: 1rem; font-weight: 650; }
.gm-drop span { font-size: .8rem; line-height: 1.5; color: var(--ink-3); }
.gm-drop kbd { font: inherit; font-size: .74rem; font-weight: 600; padding: 1px 6px; border-radius: 6px; color: var(--ink-2); background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); }
.gm-shot { position: relative; overflow: hidden; border-radius: 22px; background: rgba(0,0,0,.2); border: 1px solid var(--glass-hairline); transition: box-shadow .15s; }
.gm-shot.is-over { box-shadow: 0 0 0 3px var(--gm-accent); }
.gm-shot img { display: block; width: 100%; max-height: min(62vh, 640px); object-fit: contain; }
.gm-shot-bar { position: absolute; left: 10px; right: 10px; bottom: 10px; display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
.gm-shot-bar span.gm-pill { margin-right: auto; }
.gm-pill { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 11px; border-radius: 99px; font: inherit; font-size: .75rem; font-weight: 600; color: #fff; background: rgba(10,16,28,.56); border: 1px solid rgba(255,255,255,.22); -webkit-backdrop-filter: blur(14px) saturate(160%); backdrop-filter: blur(14px) saturate(160%); }
button.gm-pill { cursor: pointer; }
button.gm-pill:hover { background: rgba(10,16,28,.78); }
.gm-busy { position: absolute; inset: 0; display: grid; place-items: center; align-content: center; gap: 8px; font-size: .86rem; font-weight: 600; color: #fff; background: rgba(6,10,18,.45); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.gm-note { display: flex; align-items: flex-start; gap: 9px; margin: 0; padding: 10px 12px; border-radius: 14px; font-size: .82rem; line-height: 1.45; color: var(--ink-2); background: var(--gm-card); border: 1px solid var(--glass-hairline); }
.gm-note svg { width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; }
.gm-note.is-warn { color: var(--gm-warn); background: color-mix(in srgb, var(--gm-warn) 10%, transparent); border-color: color-mix(in srgb, var(--gm-warn) 32%, transparent); }
.gm-note.is-info { color: var(--ink-1); background: color-mix(in srgb, var(--gm-accent) 12%, transparent); border-color: color-mix(in srgb, var(--gm-accent) 32%, transparent); }
.gm-note.is-info svg { color: var(--gm-accent); }
.gm-note button { margin-left: auto; padding: 0; border: 0; background: none; font: inherit; font-weight: 700; color: var(--gm-accent); cursor: pointer; white-space: nowrap; }
.gm-preview { display: flex; flex-direction: column; gap: 8px; }
.gm-preview > p { margin: 0; font-size: .68rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); }
.gm-preview h5 { margin: 0; font-size: 1.02rem; font-weight: 700; letter-spacing: -.015em; line-height: 1.25; color: var(--ink-1); overflow-wrap: break-word; }
.gm-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.gm-tag { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 99px; font-size: .74rem; font-weight: 600; color: var(--ink-1); background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); }
.gm-tag i { width: 7px; height: 7px; border-radius: 99px; }
.gm-preview small { font-size: .79rem; color: var(--ink-3); }
.gm-add { display: flex; gap: 8px; }
.gm-add .gm-input { flex: 1; }
.gm-iconbtn { display: grid; place-items: center; width: 42px; height: 42px; flex-shrink: 0; border-radius: 13px; cursor: pointer; color: var(--ink-1); background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); }
.gm-iconbtn:hover:not(:disabled) { border-color: var(--gm-accent); color: var(--gm-accent); }
.gm-iconbtn:disabled { opacity: .4; cursor: default; }
.gm-places { display: flex; flex-direction: column; gap: 7px; margin-top: 10px; }
.gm-place { border-radius: 15px; background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.gm-place-top { display: flex; align-items: center; gap: 7px; min-height: 44px; padding: 6px 8px 6px 12px; }
.gm-place-top > svg { width: 15px; height: 15px; flex-shrink: 0; color: var(--ink-3); }
.gm-place-top b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .9rem; font-weight: 600; }
.gm-place-btn { display: inline-flex; align-items: center; gap: 4px; min-height: 30px; padding: 0 9px; border-radius: 10px; cursor: pointer; font: inherit; font-size: .76rem; font-weight: 600; color: var(--ink-2); background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); }
.gm-place-btn:hover { color: var(--ink-1); }
.gm-place-btn.is-del:hover { color: var(--gm-danger); border-color: color-mix(in srgb, var(--gm-danger) 50%, transparent); }
.gm-place-risk { display: flex; flex-direction: column; gap: 10px; padding: 2px 12px 12px; }
.gm-place-risk > div > span { display: block; margin-bottom: 6px; font-size: .68rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
.gm-switch { display: flex; align-items: center; gap: 12px; }
.gm-switch > svg { width: 18px; height: 18px; flex-shrink: 0; }
.gm-switch > div { flex: 1; min-width: 0; }
.gm-switch b { display: block; font-size: .92rem; font-weight: 600; }
.gm-switch small { display: block; margin-top: 1px; font-size: .78rem; line-height: 1.35; color: var(--ink-3); }
.gm-toggle { position: relative; width: 51px; height: 31px; flex-shrink: 0; padding: 0; border-radius: 99px; cursor: pointer; border: 0; background: color-mix(in srgb, var(--ink-3) 42%, transparent); transition: background .2s; }
.gm-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; border-radius: 99px; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.3); transition: transform .22s cubic-bezier(.22,1,.36,1); }
.gm-toggle[aria-checked='true'] { background: var(--c, #34c759); }
.gm-toggle[aria-checked='true']::after { transform: translateX(20px); }
.gm-sep { height: 1px; margin: 12px 0; background: var(--glass-hairline); }
.gm-rte { border-radius: 14px; border: 1px solid var(--glass-hairline); background: var(--gm-field); }
.gm-rte:focus-within { border-color: var(--gm-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--gm-accent) 24%, transparent); }
.gm-rte-bar { position: relative; display: flex; align-items: center; gap: 2px; padding: 5px; border-bottom: 1px solid var(--glass-hairline); }
.gm-rte-bar > button { display: grid; place-items: center; width: 34px; height: 30px; border-radius: 9px; cursor: pointer; color: var(--ink-2); background: transparent; border: 0; }
.gm-rte-bar > button:hover { color: var(--ink-1); background: var(--glass-fill-strong); }
.gm-rte-bar > button svg { width: 15px; height: 15px; }
.gm-rte-sep { width: 1px; height: 18px; margin: 0 4px; background: var(--glass-hairline); }
.gm-rte-count { margin-left: auto; padding-right: 8px; font-size: .74rem; color: var(--ink-3); }
.gm-rte-area { min-height: 140px; max-height: 360px; overflow-y: auto; padding: 11px 13px; font-size: 15px; line-height: 1.65; color: var(--ink-1); outline: none; white-space: pre-wrap; word-break: break-word; }
.gm-rte-area:empty::before { content: attr(data-placeholder); color: var(--ink-3); pointer-events: none; }
.gm-swatches { position: absolute; top: calc(100% + 6px); left: 4px; z-index: 5; display: grid; grid-template-columns: repeat(8, 22px); gap: 8px; padding: 11px; border-radius: 16px;
  background: var(--gm-sheet); border: 1px solid var(--glass-hairline); box-shadow: var(--gm-shadow); -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%); }
.gm-swatches button { width: 22px; height: 22px; padding: 0; border-radius: 99px; cursor: pointer; border: 2px solid var(--glass-hairline); transition: transform .12s; }
.gm-swatches button:hover { transform: scale(1.15); }
.gm-ts { display: flex; flex-direction: column; gap: 16px; }
.gm-ts-group { display: flex; flex-direction: column; gap: 9px; }
.gm-ts-label { margin: 0; font-size: .8rem; font-weight: 600; color: var(--ink-2); }
.gm-ts-label small { margin-left: 5px; font-weight: 500; color: var(--ink-3); }
.gm-ts-row { display: grid; grid-template-columns: 132px minmax(0, 1fr) 76px 92px; align-items: center; gap: 10px; }
.gm-ts-name { display: inline-flex; align-items: center; gap: 7px; min-width: 0; font-size: .86rem; font-weight: 600; color: var(--ink-1); }
.gm-ts-name svg { width: 16px; height: 16px; flex-shrink: 0; color: var(--ink-2); }
.gm-ts-range { -webkit-appearance: none; appearance: none; width: 100%; height: 8px; margin: 0; border-radius: 99px; cursor: pointer; outline: none;
  background: linear-gradient(90deg, var(--c) 0 var(--p), color-mix(in srgb, var(--ink-3) 30%, transparent) var(--p) 100%); }
.gm-ts-range::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 22px; border-radius: 99px; background: #fff; border: 0; box-shadow: 0 1px 4px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.06); }
.gm-ts-range::-moz-range-thumb { width: 22px; height: 22px; border-radius: 99px; background: #fff; border: 0; box-shadow: 0 1px 4px rgba(0,0,0,.35); }
.gm-ts-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px color-mix(in srgb, var(--gm-accent) 40%, transparent); }
.gm-ts-pct { display: inline-flex; align-items: center; gap: 4px; font-size: .84rem; font-weight: 600; color: var(--ink-2); }
.gm-ts-pct .gm-input { min-height: 36px; padding: 0 8px; text-align: right; font-size: 14px; font-weight: 700; }
.gm-ts-band { display: flex; justify-content: flex-end; }
.gm-ts-band em { font-style: normal; font-size: .76rem; color: var(--ink-3); }
.gm-ts-pair { display: grid; grid-template-columns: 132px minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: 10px; }
.gm-ts-pair .gm-select { min-height: 38px; }
.gm-ts-measures { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.gm-foot { position: relative; display: flex; align-items: center; gap: 10px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)) 20px; border-top: 1px solid var(--glass-hairline); background: color-mix(in srgb, var(--gm-sheet) 70%, transparent); }
.gm-status { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; margin: 0; font-size: .84rem; line-height: 1.35; color: var(--ink-3); }
.gm-status svg { width: 16px; height: 16px; flex-shrink: 0; }
.gm-status.is-err { color: var(--gm-danger); }
.gm-status.is-ok { color: var(--ink-2); }
.gm-status.is-ok svg { color: #34c759; }
.gm-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 18px; border-radius: 14px; cursor: pointer; font: inherit; font-size: .92rem; font-weight: 650; white-space: nowrap; color: var(--ink-1); background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); }
.gm-btn:hover:not(:disabled) { background: var(--gm-card-2); }
.gm-btn.is-primary { color: var(--gm-accent-ink); background: var(--gm-accent); border-color: transparent; box-shadow: 0 10px 24px -10px color-mix(in srgb, var(--gm-accent) 75%, transparent); }
.gm-btn.is-primary:hover:not(:disabled) { background: var(--gm-accent); filter: brightness(1.07); }
.gm-btn:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
.gm-spin { animation: gm-spin 1s linear infinite; }
@keyframes gm-spin { to { transform: rotate(360deg); } }
@media (max-width: 860px) {
  .gm { padding: 0; align-items: flex-end; }
  .gm-sheet { width: 100%; height: 94vh; height: 94dvh; border-radius: 26px 26px 0 0; }
  .gm-head { padding: 14px 12px 12px 16px; }
  .gm-head p { display: none; }
  .gm-body { grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 12px 12px 20px; }
  .gm-side { position: static; }
  .gm-drop { aspect-ratio: auto; min-height: 200px; }
  .gm-shot img { max-height: 46vh; }
  .gm-row, .gm-ts-measures { grid-template-columns: minmax(0, 1fr); }
  .gm-ts-row { grid-template-columns: minmax(0, 1fr) 72px 86px; row-gap: 6px; }
  .gm-ts-row .gm-ts-name { grid-column: 1 / -1; }
  .gm-ts-pair { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .gm-ts-pair .gm-ts-name { grid-column: 1 / -1; }
  .gm-foot { flex-wrap: wrap; padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px)); }
  .gm-status { flex-basis: 100%; }
  .gm-foot .gm-btn { flex: 1; }
}
@media (prefers-reduced-motion: reduce) { .gm-toggle, .gm-toggle::after, .gm-drop, .gm-swatches button { transition: none; } }
`;

/* ─────────────────────────────────────────────
   ADD / EDIT A GRAPHIC — one liquid-glass sheet, light and dark
   The graphic on the left: dropped in, chosen, or pasted (Ctrl+V), with its size and a check
   that it is the portrait shape the graphics are made in, and under it a preview of how its tags
   will read on the home page. Everything about it on the right, in glass cards in the order it is
   filled in. The risk ladder is the Thunderstorm graphic's own (TSTM to SVRE, the colours and
   labels of its key) for the graphic, its places and its thunderstorm details. Times have quick
   picks and say how long the graphic will be in force. A new graphic is kept as a draft while
   it is written, so closing the sheet loses nothing. The footer says what is still needed;
   Ctrl+Enter publishes. The sheet carries its own tokens (it renders over whichever page
   opened it) and follows the site's theme.
───────────────────────────────────────────── */
const EMPTY_GRAPHIC = {
  title: '', image_url: '', description: '',
  weather_condition: '', weather_conditions: [],
  condition_subtypes: [], condition_ranges: {},
  expires_at: '', in_force_from: '',
  impact_level: '', impact_levels: [],
  locations_impacted: [], impact_drawing: '', thunderstorm_data: {},
};
const NEW_FORM = { ...EMPTY_GRAPHIC, update_reason: '', update_label: '', is_initial_forecast: false, is_continuation: false, parent_graphic_id: null };
const NEW_FORM_JSON = JSON.stringify(NEW_FORM);
const newForm = () => JSON.parse(NEW_FORM_JSON);

const DRAFT_KEY = 'mwuk_graphic_draft_v1';
const readDraft = () => {
  try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return d && d.form ? d : null; } catch { return null; }
};
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage blocked */ } };

/* The graphics store their times as UK wall-clock strings ("2026-10-21T18:00"), which is what a
   datetime-local box reads and writes. */
const pad2 = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const parseLocal = (v) => { if (!v) return null; const d = new Date(v); return isValid(d) ? d : null; };
const spanWords = (ms) => {
  const h = ms / 36e5;
  if (h >= 47.5) return `${Math.round(h / 24)} days`;
  if (h >= 1) { const r = Math.round(h * 2) / 2; return `${r} hour${r === 1 ? '' : 's'}`; }
  return `${Math.max(1, Math.round(ms / 6e4))} min`;
};
const whenWords = (d) => d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const nextSix = (from) => { const d = new Date(from); d.setHours(6, 0, 0, 0); if (d <= from) d.setDate(d.getDate() + 1); return d; };
const placeName = (l) => (typeof l === 'string' ? l : l?.name || '');
const asPlace = (l) => (typeof l === 'string' ? { name: l, overall_risk: null, highest_risk: null, lowest_risk: null } : l);
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/* one place, with its risk on the graphic's ladder: overall, or lowest to highest */
function PlaceRow({ loc, onRemove, onChange }) {
  const [open, setOpen] = useState(false);
  const shown = loc.overall_risk ? [loc.overall_risk] : [...new Set([loc.lowest_risk, loc.highest_risk].filter(Boolean))];
  return (
    <div className="gm-place">
      <div className="gm-place-top">
        <MapPin />
        <b title={loc.name}>{loc.name}</b>
        {shown.map((l) => <GraphicLevelPill key={l} level={l} style={{ fontSize: 10, padding: '1px 7px' }} />)}
        <button type="button" className="gm-place-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          Risk<ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </button>
        <button type="button" className="gm-place-btn is-del" onClick={onRemove} aria-label={`Remove ${loc.name}`}><X size={13} /></button>
      </div>
      {open && (
        <div className="gm-place-risk">
          {[['overall_risk', 'Overall'], ['lowest_risk', 'Lowest'], ['highest_risk', 'Highest']].map(([key, label]) => (
            <div key={key}>
              <span>{label}</span>
              <div className="gm-ladder">
                {IMPACT_LEVELS.map((level) => (
                  <GraphicLevelChoice key={level} level={level} small selected={normLevel(loc[key]) === level}
                    onClick={() => onChange({ ...loc, [key]: normLevel(loc[key]) === level ? null : level })} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Switch({ on, onToggle, colour, label }) {
  return <button type="button" role="switch" aria-checked={!!on} aria-label={label} className="gm-toggle" style={{ '--c': colour }} onClick={onToggle} />;
}

function ForecastModal({ mode = 'add', initial = null, onClose, onSave, uploading, onUploadFile, existingForecasts = [], saving = false, error = '' }) {
  const { isDark } = useTheme();
  const isEdit = mode === 'edit';
  const [draft] = useState(() => (isEdit ? null : readDraft()));
  const [restored, setRestored] = useState(() => !!draft);
  const [editorKey, setEditorKey] = useState(0);
  const [form, setForm] = useState(() => {
    if (isEdit && initial) {
      const lv = Array.isArray(initial.impact_levels) && initial.impact_levels.length ? initial.impact_levels : initial.impact_level ? [initial.impact_level] : [];
      return {
        ...newForm(),
        title:              initial.title || '',
        image_url:          initial.image_url || '',
        description:        initial.description || '',
        weather_condition:  initial.weather_condition || '',
        weather_conditions: initial.weather_conditions?.length ? initial.weather_conditions : initial.weather_condition ? [initial.weather_condition] : [],
        condition_subtypes: initial.condition_subtypes || [],
        condition_ranges:   initial.condition_ranges || {},
        expires_at:         initial.expires_at ? initial.expires_at.slice(0, 16) : '',
        in_force_from:      initial.in_force_from ? initial.in_force_from.slice(0, 16) : '',
        impact_level:       initial.impact_level || '',
        impact_levels:      [...new Set(lv.map((l) => normLevel(l) || l))],    // older graphics stored "SLGT"
        locations_impacted: (Array.isArray(initial.locations_impacted) ? initial.locations_impacted : []).map(asPlace),
        impact_drawing:     initial.impact_drawing || '',
        thunderstorm_data:  initial.thunderstorm_data || {},
        is_initial_forecast: initial.is_initial_forecast ?? false,
      };
    }
    return draft ? { ...newForm(), ...draft.form } : newForm();
  });
  const [placeInput, setPlaceInput] = useState('');
  const [over, setOver] = useState(false);
  const [fileNote, setFileNote] = useState('');
  const [fileInfo, setFileInfo] = useState(null);
  const [dims, setDims] = useState(null);
  const fileRef = useRef(null);
  const titleRef = useRef(null);

  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));
  const toggleArr = (key, val) => setForm((p) => ({ ...p, [key]: p[key].includes(val) ? p[key].filter((x) => x !== val) : [...p[key], val] }));
  // removing a condition also drops its options and figures
  const toggleCondition = (c) => setForm((p) => {
    const has = p.weather_conditions.includes(c);
    const nextRanges = { ...p.condition_ranges };
    if (has) for (const r of (CONDITION_RANGES[c] || [])) delete nextRanges[r.key];
    const gone = has ? new Set(CONDITION_SUBTYPES[c] || []) : new Set();
    return {
      ...p,
      weather_conditions: has ? p.weather_conditions.filter((x) => x !== c) : [...p.weather_conditions, c],
      condition_subtypes: p.condition_subtypes.filter((s) => !gone.has(s)),
      condition_ranges: nextRanges,
    };
  });
  const setRange = (key, val) => setForm((p) => ({ ...p, condition_ranges: { ...p.condition_ranges, [key]: val } }));

  /* places: one at a time, or several pasted with commas */
  const addPlaces = () => {
    const names = placeInput.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    setForm((p) => {
      const have = new Set(p.locations_impacted.map((l) => placeName(l).toLowerCase()));
      const add = names.filter((n) => !have.has(n.toLowerCase()) && have.add(n.toLowerCase()));
      return { ...p, locations_impacted: [...p.locations_impacted, ...add.map((n) => asPlace(n))] };
    });
    setPlaceInput('');
  };

  /* the graphic: chosen, dropped or pasted */
  const takeFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setFileNote('That is not an image. Use a PNG or JPG of the graphic.'); return; }
    setFileNote('');
    setDims(null);
    setFileInfo({ name: file.name || 'Pasted image', size: file.size });
    const url = await onUploadFile(file);
    if (url) set('image_url', url);
  };
  const takeRef = useRef(takeFile);
  takeRef.current = takeFile;

  /* a new graphic is kept as a draft while it is written */
  useEffect(() => {
    if (isEdit) return undefined;
    const t = setTimeout(() => {
      const json = JSON.stringify(form);
      try {
        if (json === NEW_FORM_JSON) localStorage.removeItem(DRAFT_KEY);
        else localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), form }));
      } catch { /* storage blocked: no draft */ }
    }, 400);
    return () => clearTimeout(t);
  }, [form, isEdit]);
  const startAgain = () => {
    clearDraft();
    setForm(newForm());
    setRestored(false);
    setFileInfo(null); setDims(null); setFileNote('');
    setEditorKey((k) => k + 1);
  };

  // an edit can still be thrown away by a stray click, so it asks; a new graphic is a draft
  const [pristine] = useState(() => JSON.stringify(form));
  const isDirty = JSON.stringify(form) !== pristine;
  const requestClose = () => {
    if (isEdit && isDirty && !window.confirm('Discard the changes to this graphic?')) return;
    onClose();
  };

  const tIn = parseLocal(form.in_force_from), tEx = parseLocal(form.expires_at);
  const badSpan = !!(tIn && tEx && tEx <= tIn);
  const pastEnd = !!(tEx && tEx.getTime() < Date.now());
  const missing = !form.title.trim() ? 'Give the graphic a title'
    : isEdit && !form.update_label?.trim() ? 'Name this update (for example Update 1)'
      : !isEdit && !form.image_url ? 'Add the graphic image'
        : badSpan ? 'The end time is before the start'
          : '';
  const canSave = !missing && !saving && !uploading;
  const save = () => { if (canSave) onSave(form); };
  const saveRef = useRef(save);
  saveRef.current = save;
  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;

  // The handlers are refs, so this runs on open and close only — otherwise the scroll lock
  // would be torn down and put back on every keystroke.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current();
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveRef.current(); }
    };
    const onPaste = (e) => {
      const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); takeRef.current(f); }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    if (!isEdit) setTimeout(() => titleRef.current?.focus({ preventScroll: true }), 60);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quickIn = [['Now', () => new Date()], ['Next hour', () => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; }], ['06:00', () => nextSix(new Date())]];
  const base = () => tIn || new Date();
  const quickEnd = [['+6 h', () => new Date(base().getTime() + 6 * 36e5)], ['+12 h', () => new Date(base().getTime() + 12 * 36e5)], ['+24 h', () => new Date(base().getTime() + 24 * 36e5)], ['Next 06:00', () => nextSix(base())]];
  const landscape = dims && dims.w > dims.h * 1.05;

  const status = error ? { cls: 'is-err', Icon: AlertTriangle, text: error }
    : uploading ? { cls: '', Icon: Loader2, spin: true, text: 'Uploading the graphic…' }
      : missing ? { cls: '', Icon: Info, text: `${missing} to publish.` }
        : { cls: 'is-ok', Icon: CheckCircle2, text: `Ready to publish${isEdit ? ' the update' : ''} · Ctrl+Enter` };

  return createPortal(
    <motion.div
      className={`gm${isDark ? '' : ' is-light'}`}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={requestClose}
    >
      <style>{GM_CSS}</style>
      <motion.div
        className="gm-sheet"
        role="dialog" aria-modal="true" aria-labelledby="gm-title"
        initial={{ opacity: 0, y: 18, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: 0.985 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="gm-head">
          <span className="gm-badge"><ImagePlus size={19} /></span>
          <div style={{ minWidth: 0 }}>
            <h3 id="gm-title">{isEdit ? 'Update this graphic' : 'New forecast graphic'}</h3>
            <p>{isEdit ? 'The original stays on record as the initial forecast; this publishes as an update.' : 'Shown on the home page as soon as it is published.'}</p>
          </div>
          <button type="button" className="gm-x" onClick={requestClose} aria-label="Close"><X size={17} /></button>
        </header>

        <div className="gm-body">
          {/* ── the graphic and how it will read ── */}
          <aside className="gm-side">
            {form.image_url ? (
              <div className={`gm-shot${over ? ' is-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); takeFile(e.dataTransfer.files?.[0]); }}>
                <img src={form.image_url} alt="The graphic" onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
                <div className="gm-shot-bar">
                  {dims && <span className="gm-pill">{dims.w} × {dims.h}{fileInfo?.size ? ` · ${kb(fileInfo.size)}` : ''}</span>}
                  <button type="button" className="gm-pill" onClick={() => fileRef.current?.click()}><RefreshCw size={13} />Replace</button>
                  <button type="button" className="gm-pill" onClick={() => { set('image_url', ''); setDims(null); setFileInfo(null); }} aria-label="Remove the image"><X size={13} /></button>
                </div>
                {uploading && <div className="gm-busy"><Loader2 size={26} className="gm-spin" />Uploading…</div>}
              </div>
            ) : (
              <button type="button" className={`gm-drop${over ? ' is-over' : ''}`} onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); takeFile(e.dataTransfer.files?.[0]); }}>
                {uploading ? (
                  <><Loader2 size={30} className="gm-spin" style={{ color: 'var(--gm-accent)' }} /><b>Uploading…</b><span>{fileInfo?.name}</span></>
                ) : (
                  <>
                    <span className="gm-drop-icon"><Upload size={24} /></span>
                    <b>Drop the graphic here</b>
                    <span>or choose a file, or paste it with <kbd>Ctrl</kbd> + <kbd>V</kbd></span>
                    <span>PNG or JPG · portrait 1080 × 1920 works best</span>
                  </>
                )}
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { takeFile(e.target.files?.[0]); e.target.value = ''; }} />
            {fileNote && <div className="gm-note is-warn"><AlertTriangle />{fileNote}</div>}
            {landscape && <div className="gm-note is-warn"><AlertTriangle />This image is landscape. MyWeatherUK graphics are portrait (1080 × 1920), so it will show small on phones.</div>}

            <div className="gm-card gm-preview">
              <p>On the home page</p>
              <div className="gm-tags">
                {form.weather_conditions.map((c) => <span key={c} className="gm-tag"><i style={{ background: (CONDITION_CONFIG[c] || DEFAULT_CFG).accent }} />{c}</span>)}
                {IMPACT_LEVELS.filter((l) => form.impact_levels.includes(l)).map((l) => <GraphicLevelPill key={l} level={l} />)}
                {form.is_initial_forecast && <span className="gm-tag"><i style={{ background: '#38bdf8' }} />Initial forecast</span>}
                {isEdit && form.update_label?.trim() && <span className="gm-tag"><i style={{ background: '#f59e0b' }} />{form.update_label.trim()}</span>}
              </div>
              <h5>{form.title.trim() || 'Untitled graphic'}</h5>
              {(tIn || tEx) && <small>{tIn ? `In force ${whenWords(tIn)}` : 'In force now'}{tEx ? ` → ${whenWords(tEx)}` : ''}</small>}
            </div>
          </aside>

          {/* ── everything about it ── */}
          <div className="gm-main">
            {restored && (
              <div className="gm-note is-info">
                <Info />
                <span>Your unsaved graphic from {new Date(draft.at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} is back where you left it.</span>
                <button type="button" onClick={startAgain}>Start again</button>
              </div>
            )}

            {isEdit && (
              <section className="gm-card">
                <h4><RefreshCw />This update</h4>
                <div className="gm-row">
                  <label className="gm-field"><span>Update name <small>required</small></span>
                    <input className="gm-input" placeholder="e.g. Update 1" value={form.update_label || ''} onChange={(e) => set('update_label', e.target.value)} />
                  </label>
                  <label className="gm-field"><span>What changed <small>optional</small></span>
                    <input className="gm-input" placeholder="e.g. Risk area moved north" value={form.update_reason || ''} onChange={(e) => set('update_reason', e.target.value)} />
                  </label>
                </div>
              </section>
            )}

            <section className="gm-card">
              <h4><Type />Title and weather</h4>
              <label className="gm-field"><span>Title</span>
                <input ref={titleRef} className="gm-input is-big" placeholder="e.g. Thunderstorm outlook: Wednesday into Thursday" maxLength={140}
                  value={form.title} onChange={(e) => set('title', e.target.value)} />
              </label>
              <div className="gm-field" style={{ marginTop: 14 }}>
                <span>Weather <small>pick all that apply</small></span>
                <div className="gm-chips">
                  {CONDITIONS.map((c) => {
                    const cfg = CONDITION_CONFIG[c];
                    const on = form.weather_conditions.includes(c);
                    return (
                      <button key={c} type="button" className="gm-chip" aria-pressed={on} style={{ '--c': cfg.accent }} onClick={() => toggleCondition(c)}>
                        <cfg.Icon style={{ color: cfg.accent }} />{c}{on && <Check size={14} />}
                      </button>
                    );
                  })}
                </div>
              </div>
              {form.weather_conditions.filter((c) => CONDITION_SUBTYPES[c]?.length || CONDITION_RANGES[c]?.length).map((c) => {
                const cfg = CONDITION_CONFIG[c] || DEFAULT_CFG;
                return (
                  <div key={c} className="gm-sub" style={{ '--c': cfg.accent }}>
                    <b><cfg.Icon />{c}</b>
                    <div className="gm-chips">
                      {(CONDITION_SUBTYPES[c] || []).map((s) => (
                        <button key={s} type="button" className="gm-chip is-sm" aria-pressed={form.condition_subtypes.includes(s)} onClick={() => toggleArr('condition_subtypes', s)}>
                          {form.condition_subtypes.includes(s) && <Check size={12} />}{s}
                        </button>
                      ))}
                    </div>
                    {(CONDITION_RANGES[c] || []).map((r) => (
                      <label key={r.key} className="gm-field"><span>{r.label} <small>{r.unit}</small></span>
                        <input className="gm-input" placeholder={r.placeholder} value={form.condition_ranges[r.key] || ''} onChange={(e) => setRange(r.key, e.target.value)} />
                      </label>
                    ))}
                  </div>
                );
              })}
            </section>

            <section className="gm-card">
              <h4><CalendarClock />When</h4>
              <div className="gm-row">
                <label className="gm-field"><span>In force from</span>
                  <input type="datetime-local" className="gm-input" value={form.in_force_from} onChange={(e) => set('in_force_from', e.target.value)} />
                  <span className="gm-quick">
                    {quickIn.map(([t, at]) => <button key={t} type="button" onClick={() => set('in_force_from', toLocalInput(at()))}>{t}</button>)}
                    {form.in_force_from && <button type="button" onClick={() => set('in_force_from', '')}>Clear</button>}
                  </span>
                </label>
                <label className="gm-field"><span>Ends</span>
                  <input type="datetime-local" className="gm-input" value={form.expires_at} onChange={(e) => set('expires_at', e.target.value)} />
                  <span className="gm-quick">
                    {quickEnd.map(([t, at]) => <button key={t} type="button" onClick={() => set('expires_at', toLocalInput(at()))}>{t}</button>)}
                    {form.expires_at && <button type="button" onClick={() => set('expires_at', '')}>Clear</button>}
                  </span>
                </label>
              </div>
              {badSpan ? <p className="gm-span is-bad"><AlertTriangle />The end is before the start.</p>
                : pastEnd ? <p className="gm-span is-warn"><AlertTriangle />That end time has passed, so the graphic will go straight to the archive.</p>
                  : tEx ? <p className="gm-span"><Clock3 />In force {tIn ? `for ${spanWords(tEx - tIn)}` : `from publishing until ${whenWords(tEx)}`}, then it moves to the archive.</p>
                    : <p className="gm-span"><Clock3 />With no end time it stays on the home page until it is archived.</p>}
            </section>

            <section className="gm-card">
              <h4><Gauge />Risk level{form.impact_levels.length > 0 && <em>{form.impact_levels.length} chosen</em>}</h4>
              <div className="gm-ladder">
                {IMPACT_LEVELS.map((level) => (
                  <GraphicLevelChoice key={level} level={level} range selected={form.impact_levels.includes(level)} onClick={() => toggleArr('impact_levels', level)} />
                ))}
              </div>
              <p className="gm-hint">The Thunderstorm graphic&rsquo;s own bands: the same colours and labels as its key. Pick every band the graphic shows.</p>
            </section>

            {form.weather_conditions.includes('Thunderstorms') && (
              <section className="gm-card">
                <h4><Zap />Thunderstorm details</h4>
                <ThunderstormPanel data={form.thunderstorm_data || {}} onChange={(td) => set('thunderstorm_data', td)} />
              </section>
            )}

            <section className="gm-card">
              <h4><AlignLeft />Description</h4>
              <RichTextEditor key={editorKey} value={form.description} onChange={(v) => set('description', v)} placeholder="What to expect, where and when…" />
            </section>

            <section className="gm-card">
              <h4><MapPin />Places affected{form.locations_impacted.length > 0 && <em>{form.locations_impacted.length}</em>}</h4>
              <div className="gm-add">
                <input className="gm-input" placeholder="Add a place, or several separated by commas" value={placeInput}
                  onChange={(e) => setPlaceInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPlaces(); } }} />
                <button type="button" className="gm-iconbtn" onClick={addPlaces} disabled={!placeInput.trim()} aria-label="Add the place"><Plus size={17} /></button>
              </div>
              {form.locations_impacted.length > 0 && (
                <div className="gm-places">
                  {form.locations_impacted.map((raw) => {
                    const loc = asPlace(raw);
                    return (
                      <PlaceRow key={loc.name} loc={loc}
                        onRemove={() => set('locations_impacted', form.locations_impacted.filter((l) => placeName(l) !== loc.name))}
                        onChange={(next) => set('locations_impacted', form.locations_impacted.map((l) => (placeName(l) === loc.name ? next : l)))} />
                    );
                  })}
                </div>
              )}
            </section>

            <section className="gm-card">
              <h4><Flag />Forecast type</h4>
              <div className="gm-switch">
                <Flag style={{ color: '#38bdf8' }} />
                <div><b>Initial forecast</b><small>The first forecast for this event</small></div>
                <Switch label="Initial forecast" colour="#38bdf8" on={form.is_initial_forecast}
                  onToggle={() => setForm((p) => ({ ...p, is_initial_forecast: !p.is_initial_forecast, is_continuation: false, parent_graphic_id: null }))} />
              </div>
              {!form.is_initial_forecast && (
                <>
                  <div className="gm-sep" />
                  <div className="gm-switch">
                    <RefreshCw style={{ color: '#f59e0b' }} />
                    <div><b>Continues another graphic</b><small>That graphic moves to the archive when this one publishes</small></div>
                    <Switch label="Continues another graphic" colour="#f59e0b" on={form.is_continuation}
                      onToggle={() => setForm((p) => ({ ...p, is_continuation: !p.is_continuation, parent_graphic_id: null }))} />
                  </div>
                  {form.is_continuation && (
                    <select className="gm-select" style={{ marginTop: 10 }} value={form.parent_graphic_id || ''} onChange={(e) => set('parent_graphic_id', e.target.value || null)}>
                      <option value="">Choose the graphic this continues</option>
                      {existingForecasts.filter((f) => !f.is_archived && f.id !== initial?.id).map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
                    </select>
                  )}
                </>
              )}
            </section>
          </div>
        </div>

        <footer className="gm-foot">
          <p className={`gm-status ${status.cls}`} role="status"><status.Icon className={status.spin ? 'gm-spin' : undefined} />{status.text}</p>
          <button type="button" className="gm-btn" onClick={requestClose} disabled={saving}>{isEdit ? 'Cancel' : 'Close'}</button>
          <button type="button" className="gm-btn is-primary" onClick={save} disabled={!canSave}>
            {saving ? <Loader2 size={16} className="gm-spin" /> : <Check size={16} />}
            {saving ? 'Publishing…' : isEdit ? 'Publish update' : 'Publish graphic'}
          </button>
        </footer>
      </motion.div>
    </motion.div>,
    document.body
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

  const uploadFile = async (file) => {
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
    }
  };
  const handleImageUpload = async (e) => {
    const input = e.target;
    const url = await uploadFile(input.files?.[0]);
    input.value = '';                     // so the same file can be chosen again after a failure
    return url;
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
      title: form.title.trim() || 'Forecast',
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
    }, { onSuccess: clearDraft });         // published: the draft it was written in goes
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
            onUploadFile={uploadFile}
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
            onUploadFile={uploadFile}
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