/* The "Further info" panel for a forecast graphic on the home page: the graphic beside everything
   about it, in liquid glass, light or dark with the site.

   The graphic is shown whole (it is portrait; the old panel cropped it to a 280 px strip and cut
   its title off) and opens full size. Beside it: every risk level the graphic carries, drawn as the
   Thunderstorm graphic's key draws them (TSTM … SVRE, from GraphicMeta), the times with how long is
   left, the description with the colours picked in the editor (lib/cleanHtml), the forecast detail
   and measurements, the thunderstorm details read the same way as the home card's chips
   (readThunderstorm), and the places with their own risk. Escape closes it; the page behind does
   not scroll. Rendered through a portal, so whatever the home page's wrappers carry cannot move it. */
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  X, MapPin, Maximize2, Tornado, CloudHail, Waves, Wind, CloudLightning, Zap, AlertTriangle, CloudRain,
  Droplets, Ruler, Gauge, Info,
} from 'lucide-react';
import { format, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { useTheme } from '@/components/ThemeContext';
import { GraphicLevelPill, normLevel, readThunderstorm, graphicLevel, GRAPHIC_LEVEL_NAMES } from '@/components/graphics/GraphicMeta';
import { cleanHtml, richTextCss } from '@/lib/cleanHtml';
import { autoColour } from '@/lib/keywordColours';
import { sized } from '@/lib/sizedImage';

const BST_TZ = 'Europe/London';
function formatBST(iso, fmt = 'EEE d MMM, HH:mm') {
  if (!iso) return null;
  const d = new Date(iso);
  if (!isValid(d)) return null;
  return format(toZonedTime(d, BST_TZ), fmt);
}
/* how far away an instant is, in words: "in 5 h", "2 days ago" */
function fromNow(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const m = Math.round((t - Date.now()) / 60e3), a = Math.abs(m);
  const w = a < 60 ? `${a} min` : a < 48 * 60 ? `${Math.round(a / 60)} h` : `${Math.round(a / 1440)} days`;
  return m >= 0 ? `in ${w}` : `${w} ago`;
}

/* Robust to base44 returning arrays as JSON strings or CSV */
function normalizeList(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return [];
    try { const parsed = JSON.parse(t); if (Array.isArray(parsed)) return parsed.filter(Boolean); } catch { /* not JSON */ }
    return t.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}
function normalizeRanges(v) {
  let obj = v;
  if (typeof v === 'string') { try { obj = JSON.parse(v); } catch { obj = null; } }
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj).filter(([, val]) => val != null && val !== '');
}

const RANGE_META = {
  snow_accumulation_cm: ['Snow accumulation', 'cm'], ice_temp_c: ['Ice temperature', '°C'], storm_rain_mm_hr: ['Storm rain rate', 'mm/h'],
  rain_total_mm: ['Rain total', 'mm'], wind_gust_mph: ['Wind gusts', 'mph'], temp_range_c: ['Temperature range', '°C'], visibility_m: ['Visibility', 'm'],
};
const CONDITION_COLOR = { Snow: '#38bdf8', Ice: '#22d3ee', Thunderstorms: '#a78bfa', Rain: '#60a5fa', Wind: '#2dd4bf', Heat: '#f97316', 'Daily Risks': '#fbbf24' };
const HAZARD_ICON = { tornado_risk: Tornado, hail_risk: CloudHail, flash_flood_risk: Waves, strong_winds_risk: Wind, supercell_risk: CloudLightning, high_lightning: Zap, severe: AlertTriangle, heavy_rain: CloudRain };
const MEASURED_META = { hail_diameter_mm: ['Hail size', CloudHail], wind_speed_mph: ['Gusts', Wind], rain_mm_per_hour: ['Rain rate', Droplets], tornado_intensity: ['Tornado intensity (TORRO)', Tornado] };

const FI_CSS = `
.fi { --fi-panel: rgba(13,19,31,.84); --fi-card: rgba(255,255,255,.05); --fi-scrim: rgba(2,6,14,.56);
  --glass-fill: rgba(255,255,255,.05); --glass-fill-strong: rgba(255,255,255,.09); --glass-hairline: rgba(255,255,255,.11); --glass-highlight: rgba(255,255,255,.14);
  --ink-1: #f2f6fc; --ink-2: #9fb0c6; --ink-3: rgba(159,176,198,.66); --fi-accent: #56b6f5; --fi-track: rgba(255,255,255,.1);
  --fi-shadow: 0 1px 2px rgba(0,0,0,.35), 0 40px 90px -20px rgba(0,0,0,.75);
  position: fixed; inset: 0; z-index: 75; display: flex; align-items: center; justify-content: center; padding: 24px;
  background: var(--fi-scrim); -webkit-backdrop-filter: blur(10px) saturate(120%); backdrop-filter: blur(10px) saturate(120%);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', Inter, Roboto, sans-serif; color: var(--ink-1); -webkit-font-smoothing: antialiased; text-align: left; }
.fi.is-light { --fi-panel: rgba(244,247,252,.9); --fi-card: rgba(255,255,255,.78); --fi-scrim: rgba(15,23,42,.3);
  --glass-fill: rgba(255,255,255,.72); --glass-fill-strong: #ffffff; --glass-hairline: rgba(15,23,42,.1); --glass-highlight: rgba(255,255,255,.95);
  --ink-1: #0b1220; --ink-2: #4a5b70; --ink-3: rgba(74,91,112,.72); --fi-accent: #1d74c4; --fi-track: rgba(15,23,42,.1);
  --fi-shadow: 0 1px 2px rgba(15,23,42,.06), 0 40px 90px -24px rgba(15,23,42,.38); }
.fi *, .fi *::before, .fi *::after { box-sizing: border-box; }
.fi-panel { position: relative; width: min(1100px, 100%); max-height: calc(100vh - 48px); max-height: calc(100dvh - 48px); display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr);
  overflow: hidden; border-radius: 28px; background: var(--fi-panel); border: 1px solid var(--glass-hairline); box-shadow: var(--fi-shadow), inset 0 1px 0 var(--glass-highlight);
  -webkit-backdrop-filter: blur(34px) saturate(185%); backdrop-filter: blur(34px) saturate(185%); }
.fi-media { display: flex; align-items: center; justify-content: center; min-height: 0; padding: 16px; overflow: hidden; }
.fi-media button { position: relative; display: block; padding: 0; border: 0; background: none; cursor: zoom-in; max-height: 100%; }
.fi-media img { display: block; max-width: 100%; max-height: calc(100dvh - 80px); object-fit: contain; border-radius: 18px; box-shadow: 0 18px 40px -16px rgba(0,0,0,.55); }
.fi-zoom { position: absolute; right: 10px; bottom: 10px; display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 99px; font-size: .74rem; font-weight: 600; color: #fff; background: rgba(10,16,28,.55); border: 1px solid rgba(255,255,255,.22); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); pointer-events: none; }
.fi-body { display: flex; flex-direction: column; gap: 16px; min-width: 0; min-height: 0; padding: 20px 22px 24px 6px; overflow-y: auto; overscroll-behavior: contain; }
.fi-body > * { flex-shrink: 0; }
.fi-top { display: flex; align-items: flex-start; gap: 10px; }
.fi-tags { flex: 1; display: flex; flex-wrap: wrap; gap: 6px; }
.fi-tag { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 99px; font-size: .76rem; font-weight: 650; color: var(--ink-1); background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); white-space: nowrap; }
.fi-tag i { width: 7px; height: 7px; border-radius: 99px; }
.fi-x { display: grid; place-items: center; width: 38px; height: 38px; flex-shrink: 0; border-radius: 13px; cursor: pointer; color: var(--ink-2); background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.fi-x:hover { color: var(--ink-1); background: var(--glass-fill-strong); }
.fi h2 { margin: 0; font-size: clamp(1.3rem, 2.6vw, 1.7rem); font-weight: 700; letter-spacing: -.025em; line-height: 1.15; text-wrap: balance; color: var(--ink-1); }
.fi-label { display: flex; align-items: center; gap: 8px; margin: 2px 0 -6px; font-size: .68rem; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); }
.fi-label svg { width: 14px; height: 14px; }
.fi-levels { display: flex; flex-wrap: wrap; gap: 6px; }
.fi-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.fi-tile { padding: 10px 12px; border-radius: 14px; background: var(--fi-card); border: 1px solid var(--glass-hairline); }
.fi-tile span { display: flex; align-items: center; gap: 6px; font-size: .64rem; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
.fi-tile span svg { width: 13px; height: 13px; }
.fi-tile b { display: block; margin-top: 3px; font-size: .95rem; font-weight: 650; color: var(--ink-1); }
.fi-tile small { display: block; margin-top: 1px; font-size: .76rem; color: var(--ink-2); }
.fi-desc { font-size: .96rem; line-height: 1.7; color: var(--ink-2); overflow-wrap: break-word; }
.fi-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.fi-box { border-radius: 18px; background: var(--fi-card); border: 1px solid var(--glass-hairline); overflow: hidden; }
.fi-hz { display: grid; grid-template-columns: minmax(118px, auto) minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--glass-hairline); }
.fi-hz:first-child { border-top: 0; }
.fi-hz-name { display: inline-flex; align-items: center; gap: 8px; font-size: .86rem; font-weight: 600; color: var(--ink-1); white-space: nowrap; }
.fi-hz-name svg { width: 16px; height: 16px; color: var(--ink-2); }
.fi-bar { position: relative; height: 8px; border-radius: 99px; background: var(--fi-track); overflow: hidden; }
.fi-bar i { position: absolute; inset: 0 auto 0 0; border-radius: 99px; background: var(--c); transform-origin: left; animation: fi-grow .7s cubic-bezier(.22,1,.36,1) both; }
@keyframes fi-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.fi-hz-end { display: inline-flex; align-items: center; gap: 7px; justify-content: flex-end; font-size: .84rem; font-weight: 750; color: var(--ink-1); font-variant-numeric: tabular-nums; }
.fi-hz-end em { font-style: normal; opacity: .55; }
.fi-places { display: grid; gap: 6px; }
.fi-place { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 9px 12px; border-radius: 14px; font-size: .9rem; background: var(--fi-card); border: 1px solid var(--glass-hairline); }
.fi-place svg { width: 14px; height: 14px; flex-shrink: 0; color: var(--ink-3); }
.fi-place b { margin-right: auto; font-weight: 600; color: var(--ink-1); }
.fi-place small { font-size: .7rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); }
.fi-note { display: flex; gap: 8px; padding: 10px 12px; border-radius: 14px; font-size: .86rem; line-height: 1.5; color: var(--ink-1); background: color-mix(in srgb, var(--fi-accent) 12%, transparent); border: 1px solid color-mix(in srgb, var(--fi-accent) 30%, transparent); }
.fi-note svg { width: 16px; height: 16px; flex-shrink: 0; margin-top: 2px; color: var(--fi-accent); }
.fi-btn { align-self: flex-start; display: inline-flex; align-items: center; gap: 7px; min-height: 40px; padding: 0 16px; border-radius: 13px; cursor: pointer; font: inherit; font-size: .88rem; font-weight: 650; color: var(--fi-panel); background: var(--ink-1); border: 0; }
@media (max-width: 860px) {
  .fi { padding: 0; align-items: flex-end; }
  .fi-panel { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto; max-height: 94vh; max-height: 94dvh; border-radius: 26px 26px 0 0; overflow-y: auto; overscroll-behavior: contain; }
  .fi-media { padding: 12px 12px 0; }
  .fi-media img { max-height: 56vh; }
  .fi-body { padding: 14px 16px calc(22px + env(safe-area-inset-bottom, 0px)); overflow: visible; }
  .fi-hz { grid-template-columns: minmax(0, 1fr) auto; row-gap: 6px; }
  .fi-hz .fi-bar { grid-column: 1 / -1; grid-row: 2; }
}
@media (prefers-reduced-motion: reduce) { .fi-bar i { animation: none; } }
${richTextCss('.fi-desc', '.fi.is-light', '.fi:not(.is-light)')}
`;

export default function ForecastFurtherInfo({ forecast: g, onClose, onView }) {
  const { isDark } = useTheme();

  /* Escape closes; the page behind stays where it was */
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const conditions = normalizeList(g.weather_conditions).length ? normalizeList(g.weather_conditions) : g.weather_condition ? [g.weather_condition] : [];
  /* every level the graphic carries, in ladder order (older graphics stored "SLGT") */
  const rawLevels = normalizeList(g.impact_levels).length ? normalizeList(g.impact_levels) : g.impact_level ? [g.impact_level] : [];
  const levels = GRAPHIC_LEVEL_NAMES.filter((l) => rawLevels.some((r) => normLevel(r) === l));
  const subtypes = normalizeList(g.condition_subtypes);
  const ranges = normalizeRanges(g.condition_ranges);
  const storm = readThunderstorm(g.thunderstorm_data);
  const places = normalizeList(g.locations_impacted).map((l) => (typeof l === 'string' ? { name: l } : l)).filter((l) => l?.name);
  const ended = g.expires_at && Date.parse(g.expires_at) < Date.now();
  const wasEdited = g.updated_date && g.created_date && Date.parse(g.updated_date) - Date.parse(g.created_date) > 5000;

  return createPortal(
    <motion.div className={`fi${isDark ? '' : ' is-light'}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} onClick={onClose}>
      <style>{FI_CSS}</style>
      <motion.div className="fi-panel" role="dialog" aria-modal="true" aria-label={g.title || 'Forecast graphic'}
        initial={{ opacity: 0, y: 16, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}>
        <div className="fi-media">
          {g.image_url && (
            <button type="button" onClick={() => onView?.(g)} aria-label="View the graphic full size">
              <img src={sized(g.image_url, 1200)} alt={g.title || 'Forecast graphic'} />
              {onView && <span className="fi-zoom"><Maximize2 size={13} />Full size</span>}
            </button>
          )}
        </div>

        <div className="fi-body">
          <div className="fi-top">
            <div className="fi-tags">
              {conditions.map((c) => <span key={c} className="fi-tag"><i style={{ background: CONDITION_COLOR[c] || '#94a3b8' }} />{c}</span>)}
              {g.forecast_update_label && <span className="fi-tag"><i style={{ background: g.is_initial_forecast ? '#38bdf8' : '#f59e0b' }} />{g.forecast_update_label}</span>}
              {!g.forecast_update_label && g.is_initial_forecast && <span className="fi-tag"><i style={{ background: '#38bdf8' }} />Initial forecast</span>}
            </div>
            <button type="button" className="fi-x" onClick={onClose} aria-label="Close"><X size={17} /></button>
          </div>

          <h2>{g.title || 'Forecast'}</h2>

          {levels.length > 0 && (
            <>
              <p className="fi-label">Risk</p>
              <div className="fi-levels">{levels.map((l) => <GraphicLevelPill key={l} level={l} range style={{ fontSize: '.78rem', padding: '4px 11px' }} />)}</div>
            </>
          )}

          <div className="fi-tiles">
            {g.in_force_from && <div className="fi-tile"><span>In force</span><b>{formatBST(g.in_force_from)}</b><small>{fromNow(g.in_force_from)}</small></div>}
            {g.expires_at && <div className="fi-tile"><span>{ended ? 'Ended' : 'Ends'}</span><b>{formatBST(g.expires_at)}</b><small>{fromNow(g.expires_at)}</small></div>}
            {g.created_date && <div className="fi-tile"><span>Issued</span><b>{formatBST(g.created_date)}</b></div>}
            {wasEdited && <div className="fi-tile"><span>Updated</span><b>{formatBST(g.updated_date)}</b></div>}
          </div>

          {g.update_reason && <div className="fi-note"><Info /><span><b>What changed: </b>{g.update_reason}</span></div>}

          {g.description && (
            <>
              <p className="fi-label">The forecast</p>
              <div className="fi-desc" dangerouslySetInnerHTML={{ __html: g.auto_colour !== false ? autoColour(cleanHtml(g.description)) : cleanHtml(g.description) }} />
            </>
          )}

          {subtypes.length > 0 && (
            <>
              <p className="fi-label">Forecast detail</p>
              <div className="fi-chips">{subtypes.map((s) => <span key={s} className="fi-tag">{s}</span>)}</div>
            </>
          )}

          {ranges.length > 0 && (
            <>
              <p className="fi-label"><Ruler />Measurements</p>
              <div className="fi-tiles">
                {ranges.map(([k, v]) => {
                  const [label, unit] = RANGE_META[k] || [k.replace(/_/g, ' '), ''];
                  return <div key={k} className="fi-tile"><span>{label}</span><b>{v}{unit ? ` ${unit}` : ''}</b></div>;
                })}
              </div>
            </>
          )}

          {(storm.items.length > 0 || storm.measured.length > 0) && (
            <>
              <p className="fi-label"><Zap />Thunderstorm risk</p>
              {storm.items.length > 0 && (
                <div className="fi-box">
                  {storm.items.map((it) => {
                    const Icon = HAZARD_ICON[it.key] || Gauge;
                    const band = graphicLevel(it.levels[it.levels.length - 1]);
                    return (
                      <div key={it.key} className="fi-hz" style={{ '--c': band?.level === 'Conditional Severe' ? '#94a3b8' : band?.color || 'var(--fi-accent)' }}>
                        <span className="fi-hz-name"><Icon />{it.label}</span>
                        {it.pct != null ? <span className="fi-bar"><i style={{ width: `${Math.min(100, it.pct)}%` }} /></span> : <span />}
                        <span className="fi-hz-end">
                          {it.value}
                          {it.levels.map((l, i) => (
                            <React.Fragment key={l}>
                              {it.range && i > 0 && <em>–</em>}
                              <GraphicLevelPill level={l} style={{ fontSize: '.7rem', padding: '2px 8px' }} />
                            </React.Fragment>
                          ))}
                          {!it.value && !it.levels.length && 'Yes'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {storm.measured.length > 0 && (
                <div className="fi-tiles">
                  {storm.measured.map((m) => {
                    const [label, Icon] = MEASURED_META[m.key] || [m.label, Gauge];
                    return <div key={m.key} className="fi-tile"><span><Icon />{label}</span><b>{m.value}</b></div>;
                  })}
                </div>
              )}
            </>
          )}

          {places.length > 0 && (
            <>
              <p className="fi-label"><MapPin />Places affected</p>
              <div className="fi-places">
                {places.map((l, i) => {
                  const overall = normLevel(l.overall_risk), lo = normLevel(l.lowest_risk), hi = normLevel(l.highest_risk);
                  return (
                    <div key={`${l.name}${i}`} className="fi-place">
                      <MapPin /><b>{l.name}</b>
                      {overall ? <GraphicLevelPill level={overall} />
                        : (lo || hi) && (
                          <>
                            {lo && <><small>Lowest</small><GraphicLevelPill level={lo} /></>}
                            {hi && hi !== lo && <><small>Highest</small><GraphicLevelPill level={hi} /></>}
                          </>
                        )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {g.image_url && onView && <button type="button" className="fi-btn" onClick={() => onView(g)}><Maximize2 size={15} />View the graphic full size</button>}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
