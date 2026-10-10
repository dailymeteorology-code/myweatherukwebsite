import React, { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import RichTextEditor from '@/components/RichTextEditor';
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import MobileSelect from '@/components/MobileSelect';
import { useUnits } from '@/components/useUnits';
import {
  Loader2, Plus, Trash2, Upload, X, Check,
  Map, RotateCcw, CheckCheck, Archive, Radio, Clock, ChevronDown, ChevronUp
} from 'lucide-react';
import { toast } from 'sonner';
import { format, isValid } from 'date-fns';

// ── Risk Levels — now includes "No Risk" ─────────────────────────────────────
const RISK_LEVELS = ['No Risk', 'Very Low', 'Low', 'Marginal', 'Moderate', 'High'];

const RISK_COLORS = {
  'No Risk':  { fill: '#cbd5e1', stroke: '#64748b' },
  'Very Low': { fill: '#86efac', stroke: '#15803d' },
  'Low':      { fill: '#4ade80', stroke: '#166534' },
  'Marginal': { fill: '#fde047', stroke: '#a16207' },
  'Moderate': { fill: '#fb923c', stroke: '#c2410c' },
  'High':     { fill: '#f87171', stroke: '#b91c1c' },
};

const RISK_STYLES = {
  'No Risk':  'border-slate-400 text-slate-400',
  'Very Low': 'border-green-300 text-green-400',
  Low: 'border-green-600 text-green-600',
  Marginal: 'border-yellow-400 text-yellow-500',
  Moderate: 'border-orange-500 text-orange-500',
  High: 'border-red-500 text-red-500',
};

// Top-bar accent colours for graphic cards (used in TCMSection)
export const RISK_TOP_COLORS = {
  'No Risk':  '#94a3b8',
  'Very Low': '#86efac',
  'Low':      '#22c55e',
  'Marginal': '#facc15',
  'Moderate': '#f97316',
  'High':     '#ef4444',
};

const DEFAULT_PEAK_24H = [
  { time: '00:00', label: 'Midnight', risk_level: 'No Risk', activity: 0 },
  { time: '03:00', label: '3am',      risk_level: 'No Risk', activity: 0 },
  { time: '06:00', label: '6am',      risk_level: 'No Risk', activity: 0 },
  { time: '09:00', label: '9am',      risk_level: 'No Risk', activity: 0 },
  { time: '12:00', label: 'Noon',     risk_level: 'No Risk', activity: 0 },
  { time: '15:00', label: '3pm',      risk_level: 'No Risk', activity: 0 },
  { time: '18:00', label: '6pm',      risk_level: 'No Risk', activity: 0 },
  { time: '21:00', label: '9pm',      risk_level: 'No Risk', activity: 0 },
];

const empty = {
  title: '', image_url: '', outlook_date: '', is_today: false, is_tomorrow: false, is_two_day: false, is_upcoming: false,
  risk_level: '', risk_levels: [], summary: '', is_published: true,
  description: '', overall_risk: '', peak_24h: DEFAULT_PEAK_24H, peak_window: '',
  thunderstorm_overview: '', show_auto_outlook: false, show_high_res: false,
  update_reason: '', updated_at: '', risk_areas: [],
  thunderstorm_risks: {}, is_archived: false,
  forecast_type: 'initial', update_number: null,
};

const OUTLOOKS_CACHE_KEY = 'tcm_outlooks_cache';

function getRiskRange(levels) {
  const order = ['No Risk', 'Very Low', 'Low', 'Marginal', 'Moderate', 'High'];
  if (!levels || levels.length === 0) return '';
  if (levels.length === 1) return levels[0] === 'No Risk' ? 'No Risk' : levels[0] + ' Risk';
  const sorted = [...levels].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return `${sorted[0]} to ${sorted[sorted.length - 1]} Risk`;
}

const PERCENT_RISKS = [
  { key: 'tornado_risk',      label: 'Tornadoes',      color: 'from-red-500 to-red-700',      text: 'text-red-400',    border: 'border-red-500' },
  { key: 'hail_risk',         label: 'Hail',           color: 'from-sky-400 to-sky-600',       text: 'text-sky-400',    border: 'border-sky-500' },
  { key: 'flash_flood_risk',  label: 'Flash Flooding', color: 'from-blue-500 to-blue-700',     text: 'text-blue-400',   border: 'border-blue-500' },
  { key: 'strong_winds_risk', label: 'Strong Winds',   color: 'from-teal-400 to-teal-600',     text: 'text-teal-400',   border: 'border-teal-500' },
  { key: 'supercell_risk',    label: 'Supercells',     color: 'from-purple-500 to-purple-700', text: 'text-purple-400', border: 'border-purple-500' },
];

const BOOL_RISKS = [
  { key: 'high_lightning', label: 'High Lightning Risk', active: 'bg-yellow-400 text-slate-900 border-yellow-400', inactive: 'border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10' },
  { key: 'severe',         label: 'Severe',               active: 'bg-orange-500 text-white border-orange-500',    inactive: 'border-orange-500/50 text-orange-400 hover:bg-orange-500/10' },
  { key: 'heavy_rain',     label: 'Heavy Rain',           active: 'bg-blue-500 text-white border-blue-500',        inactive: 'border-blue-500/50 text-blue-400 hover:bg-blue-500/10' },
];

const TORRO_SCALE = [
  { value: 'FC',  label: 'FC — Funnel Cloud (no contact)' },
  { value: 'T0',  label: 'T0 — Light (17–24 mph)' },
  { value: 'T1',  label: 'T1 — Mild (25–38 mph)' },
  { value: 'T2',  label: 'T2 — Moderate (39–54 mph)' },
  { value: 'T3',  label: 'T3 — Strong (55–72 mph)' },
  { value: 'T4',  label: 'T4 — Severe (73–92 mph)' },
  { value: 'T5',  label: 'T5 — Intense (93–114 mph)' },
  { value: 'T6',  label: 'T6 — Moderately Devastating (115–136 mph)' },
  { value: 'T7',  label: 'T7 — Strongly Devastating (137–160 mph)' },
  { value: 'T8',  label: 'T8 — Severely Devastating (161–186 mph)' },
  { value: 'T9',  label: 'T9 — Intensely Devastating (187–212 mph)' },
  { value: 'T10', label: 'T10 — Super Tornado (213+ mph)' },
];

function ThunderstormPanel({ data = {}, onChange }) {
  const set = (key, value) => onChange({ ...data, [key]: value });
  const { windUnit, precipUnit, hailUnit, hailToMm, hailFromMm } = useUnits();

  return (
    <div className="mt-4 pt-4 border-t border-purple-500/30 space-y-5">
      <p className="text-xs font-bold uppercase tracking-widest text-purple-400">⚡ Thunderstorm Risk Details</p>

      <div className="space-y-3">
        <Label className="text-slate-300 text-sm">Percentage Risks</Label>
        {PERCENT_RISKS.map(({ key, label, color, text, border }) => {
          const val = data[key] ?? 0;
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold ${text}`}>{label}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${border} ${text} bg-transparent`}>{val}%</span>
              </div>
              <div className="relative h-2 rounded-full bg-slate-700 overflow-hidden">
                <div className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${color} transition-all`} style={{ width: `${val}%` }} />
                <input
                  type="range" min="0" max="100" step="1" value={val}
                  onChange={e => set(key, Number(e.target.value))}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <Label className="text-slate-300 text-sm">Additional Hazards</Label>
        <div className="flex flex-wrap gap-2">
          {BOOL_RISKS.map(({ key, label, active, inactive }) => {
            const on = !!data[key];
            return (
              <button
                key={key} type="button"
                onClick={() => set(key, !on)}
                className={`px-3 py-1.5 rounded-full border-2 text-xs font-bold transition-all ${on ? active : inactive}`}
              >
                {on ? '✓ ' : ''}{label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-teal-400 text-xs font-semibold">Wind Speed ({windUnit})</Label>
          <Input
            type="number" min="0" placeholder="e.g. 60"
            value={data.wind_speed_mph ?? ''}
            onChange={e => set('wind_speed_mph', e.target.value ? Number(e.target.value) : undefined)}
            className="bg-slate-900/50 border-teal-500/40 text-white text-sm focus:border-teal-400"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-blue-400 text-xs font-semibold">Rainfall ({precipUnit}/hr)</Label>
          <Input
            type="number" min="0" placeholder="e.g. 25"
            value={data.rain_mm_per_hour ?? ''}
            onChange={e => set('rain_mm_per_hour', e.target.value ? Number(e.target.value) : undefined)}
            className="bg-slate-900/50 border-blue-500/40 text-white text-sm focus:border-blue-400"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-sky-400 text-xs font-semibold">Hail Diameter ({hailUnit})</Label>
          <Input
            type="number" min="0" placeholder={hailUnit === 'inches' ? 'e.g. 0.75' : 'e.g. 20'}
            value={hailFromMm(data.hail_diameter_mm)}
            onChange={e => set('hail_diameter_mm', hailToMm(e.target.value))}
            className="bg-slate-900/50 border-sky-500/40 text-white text-sm focus:border-sky-400"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-red-400 text-xs font-semibold">Tornado Intensity (TORRO)</Label>
          <MobileSelect
            value={data.tornado_intensity ?? ''}
            onChange={v => set('tornado_intensity', v || undefined)}
            options={[{ value: '', label: '— None —' }, ...TORRO_SCALE.map(t => ({ value: t.value, label: t.label }))]}
            placeholder="— None —"
            label="Tornado Intensity (TORRO)"
            className="bg-slate-900/50 border-red-500/40 text-white"
          />
        </div>
      </div>
    </div>
  );
}

let _leafletPromise = null;
function loadLeaflet() {
  if (_leafletPromise) return _leafletPromise;
  _leafletPromise = new Promise((resolve) => {
    if (window.L) { resolve(); return; }
    if (!document.querySelector('#leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css'; link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = resolve;
    document.head.appendChild(script);
  });
  return _leafletPromise;
}

function RiskAreaMap({ areas = [], onChange }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const committedRef = useRef([]);
  const previewPolyRef = useRef(null);
  const previewDotsRef = useRef([]);

  const [ready, setReady] = useState(false);
  const [activeRisk, setActiveRisk] = useState('Moderate');
  const [drawing, setDrawing] = useState(false);
  const [pts, setPts] = useState([]);

  useEffect(() => { loadLeaflet().then(() => setReady(true)); }, []);

  useEffect(() => {
    if (!ready || !mapContainerRef.current || mapRef.current) return;
    const L = window.L;
    const map = L.map(mapContainerRef.current, { center: [54.5, -2.5], zoom: 6 });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© OpenStreetMap © Esri', maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    areas.forEach(area => addAreaToMap(L, map, area));
  }, [ready]); // eslint-disable-line

  useEffect(() => {
    if (mapContainerRef.current)
      mapContainerRef.current.style.cursor = drawing ? 'crosshair' : '';
  }, [drawing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !drawing) return;
    const L = window.L;
    const { fill, stroke } = RISK_COLORS[activeRisk];
    const handleClick = (e) => {
      const latlng = e.latlng;
      const dot = L.circleMarker(latlng, { radius: 5, color: stroke, fillColor: fill, fillOpacity: 1, weight: 2 }).addTo(map);
      previewDotsRef.current.push(dot);
      setPts(prev => {
        const next = [...prev, latlng];
        if (previewPolyRef.current) { map.removeLayer(previewPolyRef.current); previewPolyRef.current = null; }
        if (next.length >= 2) {
          previewPolyRef.current = L.polygon([...next, next[0]], { color: stroke, fillColor: fill, fillOpacity: 0.25, weight: 2, dashArray: '7 5' }).addTo(map);
        }
        return next;
      });
    };
    map.on('click', handleClick);
    return () => map.off('click', handleClick);
  }, [drawing, activeRisk, ready]);

  function addAreaToMap(L, map, area) {
    const { fill, stroke } = RISK_COLORS[area.risk_level] || { fill: '#94a3b8', stroke: '#475569' };
    const layer = L.polygon(area.points, { color: stroke, weight: 2.5, fillColor: fill, fillOpacity: 0.4 }).addTo(map);
    layer.bindTooltip(`${area.risk_level} Risk`, { permanent: false, sticky: true });
    committedRef.current.push({ area, layer });
    return layer;
  }

  function clearPreview() {
    const map = mapRef.current;
    if (!map) return;
    if (previewPolyRef.current) { map.removeLayer(previewPolyRef.current); previewPolyRef.current = null; }
    previewDotsRef.current.forEach(d => map.removeLayer(d));
    previewDotsRef.current = [];
  }

  const finishPolygon = useCallback(() => {
    if (pts.length < 3) { toast.error('Need at least 3 points'); return; }
    clearPreview();
    const area = { id: Date.now().toString(), risk_level: activeRisk, points: pts.map(p => [p.lat, p.lng]) };
    addAreaToMap(window.L, mapRef.current, area);
    setPts([]); setDrawing(false);
    onChange(prev => [...(prev || []), area]);
    toast.success(`${activeRisk} risk area saved`);
  }, [pts, activeRisk, onChange]);

  const cancelDrawing = useCallback(() => { clearPreview(); setPts([]); setDrawing(false); }, []);

  const undoLastPoint = useCallback(() => {
    const map = mapRef.current; const L = window.L;
    if (!map) return;
    const lastDot = previewDotsRef.current.pop();
    if (lastDot) map.removeLayer(lastDot);
    setPts(prev => {
      const next = prev.slice(0, -1);
      if (previewPolyRef.current) { map.removeLayer(previewPolyRef.current); previewPolyRef.current = null; }
      if (next.length >= 2) {
        const { fill, stroke } = RISK_COLORS[activeRisk];
        previewPolyRef.current = L.polygon([...next, next[0]], { color: stroke, fillColor: fill, fillOpacity: 0.25, weight: 2, dashArray: '7 5' }).addTo(map);
      }
      return next;
    });
  }, [activeRisk]);

  const removeArea = useCallback((idx) => {
    const map = mapRef.current; if (!map) return;
    map.removeLayer(committedRef.current[idx].layer);
    committedRef.current.splice(idx, 1);
    onChange(committedRef.current.map(c => c.area));
  }, [onChange]);

  const clearAll = useCallback(() => {
    const map = mapRef.current; if (!map) return;
    cancelDrawing();
    committedRef.current.forEach(({ layer }) => map.removeLayer(layer));
    committedRef.current = []; onChange([]);
  }, [cancelDrawing, onChange]);

  // Only show non-"No Risk" levels in map drawing
  const drawableRisks = RISK_LEVELS.filter(l => l !== 'No Risk');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Risk to draw:</span>
        {drawableRisks.map(level => {
          const { fill, stroke } = RISK_COLORS[level];
          const active = activeRisk === level;
          return (
            <button key={level} type="button" onClick={() => !drawing && setActiveRisk(level)} disabled={drawing}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all disabled:opacity-40"
              style={{ borderColor: stroke, background: active ? fill : 'transparent', color: active ? '#1e293b' : stroke }}>
              {active && <Check className="w-3 h-3" />}{level}
            </button>
          );
        })}
      </div>

      <div className="relative rounded-xl overflow-hidden border-2 border-purple-200" style={{ height: 420 }}>
        {!ready && <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100"><Loader2 className="w-6 h-6 animate-spin text-purple-500" /></div>}
        <div ref={mapContainerRef} style={{ height: '100%', width: '100%' }} />
        {drawing && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
            <div className="bg-slate-900/80 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full font-medium whitespace-nowrap">
              {pts.length === 0 ? 'Click to place first point' : pts.length < 3 ? `${pts.length} point${pts.length > 1 ? 's' : ''} — keep clicking` : `${pts.length} points — press Finish or keep adding`}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {!drawing ? (
          <>
            <Button type="button" size="sm" onClick={() => setDrawing(true)} className="gap-1.5 bg-purple-600 hover:bg-purple-700 text-white">
              <Map className="w-3.5 h-3.5" /> Draw {activeRisk} Area
            </Button>
            {committedRef.current.length > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={clearAll} className="gap-1.5 text-red-500 border-red-200 hover:bg-red-50">
                <RotateCcw className="w-3.5 h-3.5" /> Clear All
              </Button>
            )}
          </>
        ) : (
          <>
            <Button type="button" size="sm" onClick={finishPolygon} disabled={pts.length < 3} className="gap-1.5 bg-green-600 hover:bg-green-700 text-white">
              <CheckCheck className="w-3.5 h-3.5" /> Finish Area ({pts.length} pts)
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={undoLastPoint} disabled={pts.length === 0} className="gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" /> Undo Point
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={cancelDrawing} className="gap-1.5 text-red-500 border-red-200 hover:bg-red-50">
              <X className="w-3.5 h-3.5" /> Cancel
            </Button>
          </>
        )}
      </div>

      {committedRef.current.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {committedRef.current.map(({ area }, i) => {
            const { fill, stroke } = RISK_COLORS[area.risk_level] || {};
            return (
              <span key={area.id} className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border-2"
                style={{ borderColor: stroke, background: fill, color: '#1e293b' }}>
                {area.risk_level} Area {i + 1}
                <button type="button" onClick={() => removeArea(i)} className="hover:opacity-60 ml-0.5"><X className="w-2.5 h-2.5" /></button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Collapsible section header ─────────────────────────────────────── */
function SectionHeader({ icon, label, count, color, bgColor, borderColor, open, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors"
      style={{ background: bgColor, border: `1px solid ${borderColor}` }}
    >
      <div className="flex items-center gap-2.5">
        <span style={{ color }}>{icon}</span>
        <span className="text-sm font-bold" style={{ color }}>{label}</span>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: borderColor, color }}>
          {count}
        </span>
      </div>
      {open
        ? <ChevronUp className="w-4 h-4" style={{ color }} />
        : <ChevronDown className="w-4 h-4" style={{ color }} />
      }
    </button>
  );
}

/* ── Outlook Card (admin list row) ─────────────────────────────────── */
function OutlookRow({ o, onEdit, onDelete, deletePending }) {
  const topColor = RISK_TOP_COLORS[o.risk_level] || RISK_TOP_COLORS['No Risk'];
  return (
    <Card className="overflow-hidden border-0 shadow-sm">
      {/* coloured top bar matching risk level */}
      <div style={{ height: 3, background: topColor }} />
      <div className="p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {o.image_url && <img src={o.image_url} alt="" className="w-12 h-10 object-cover rounded-lg flex-shrink-0" />}
          <div className="min-w-0">
            <p className="font-medium text-slate-800 text-sm truncate">{o.title}</p>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              {o.outlook_date && (
                <span className="text-xs text-slate-500">
                  {isValid(new Date(o.outlook_date)) ? format(new Date(o.outlook_date + 'T12:00:00'), 'dd MMM yyyy') : o.outlook_date}
                </span>
              )}
              {o.risk_level && (
                <span className={`text-xs font-bold border px-1.5 py-0.5 rounded ${RISK_STYLES[o.risk_level] || 'border-slate-400 text-slate-400'}`}>
                  {o.risk_level}
                </span>
              )}
              {o.forecast_type === 'initial' && (
                <span className="text-xs bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-bold border border-sky-200">Initial Forecast</span>
              )}
              {o.forecast_type === 'update' && (
                <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold border border-orange-200">
                  Update {o.update_number ? `#${o.update_number}` : ''}
                </span>
              )}
              {o.is_today    && <span className="text-xs bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-medium">Today</span>}
              {o.is_tomorrow && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Tomorrow</span>}
              {o.is_two_day  && <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">2 Day</span>}
              {o.is_upcoming && <span className="text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-medium">3rd Day (Upcoming)</span>}
              {o.is_archived && <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">Archived</span>}
              {!o.is_published && <span className="text-xs bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded">Hidden</span>}
              {o.risk_areas?.length > 0 && (
                <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                  {o.risk_areas.length} area{o.risk_areas.length > 1 ? 's' : ''} mapped
                </span>
              )}
              {(() => {
                const tr = o.thunderstorm_risks || {};
                const hasMeaningful =
                  ['tornado_risk', 'hail_risk', 'flash_flood_risk', 'strong_winds_risk', 'supercell_risk']
                    .some(k => (tr[k] ?? 0) > 0) ||
                  ['high_lightning', 'severe', 'heavy_rain'].some(k => !!tr[k]) ||
                  !!(tr.wind_speed_mph || tr.rain_mm_per_hour || tr.hail_diameter_mm || tr.tornado_intensity);
                return hasMeaningful
                  ? <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">⚡ Risk data</span>
                  : null;
              })()}
            </div>
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={() => onEdit(o)}>Edit</Button>
          <Button
            size="icon" variant="ghost"
            className="h-8 w-8 hover:bg-red-50 hover:text-red-600"
            disabled={deletePending}
            onClick={() => { if (window.confirm('Delete this outlook?')) onDelete(o.id); }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ── Main Admin Component ───────────────────────────────────────────── */
export default function TCMAdmin() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [liveOpen, setLiveOpen] = useState(true);
  const [upcomingOpen, setUpcomingOpen] = useState(true);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const { data: siteSettings, refetch: refetchSettings } = useQuery({
    queryKey: ['siteSettings'],
    queryFn: async () => { const list = await base44.entities.SiteSettings.list(); return list[0] || null; },
  });

  const logoMutation = useMutation({
    mutationFn: (url) => siteSettings
      ? base44.entities.SiteSettings.update(siteSettings.id, { tcm_logo_url: url })
      : base44.entities.SiteSettings.create({ site_name: 'My Site', tcm_logo_url: url }),
    onSuccess: () => { refetchSettings(); toast.success('TCM logo saved!'); },
  });

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setLogoUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    await logoMutation.mutateAsync(file_url);
    setLogoUploading(false);
  };

  // ── localStorage-backed outlooks cache for instant load ────────────────────
  const cachedOutlooks = (() => {
    try { return JSON.parse(localStorage.getItem(OUTLOOKS_CACHE_KEY) || 'null'); } catch { return null; }
  })();

  const { data: outlooks = cachedOutlooks || [], isLoading } = useQuery({
    queryKey: ['tcmOutlooks'],
    queryFn: async () => {
      const list = await base44.entities.TCMOutlook.list('-outlook_date');
      try { localStorage.setItem(OUTLOOKS_CACHE_KEY, JSON.stringify(list)); } catch {}
      return list;
    },
    placeholderData: cachedOutlooks || [],
    staleTime: 30_000,
  });

  // ── Categorise outlooks ──────────────────────────────────────────────
  const liveOutlooks     = outlooks.filter(o => !o.is_archived && !o.is_upcoming);
  const upcomingOutlooks = outlooks.filter(o => o.is_upcoming && !o.is_archived);
  const archivedOutlooks = outlooks.filter(o => o.is_archived);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const { id, ...rest } = data;
      rest.thunderstorm_risks = rest.thunderstorm_risks ?? {};
      rest.risk_areas = rest.risk_areas ?? [];
      rest.is_today    = !!rest.is_today;
      rest.is_tomorrow = !!rest.is_tomorrow;
      rest.is_two_day  = !!rest.is_two_day;
      rest.is_upcoming = !!rest.is_upcoming;
      rest.is_archived = !!rest.is_archived;
      rest.is_published = rest.is_published !== false;
      if (id && rest.update_reason) rest.updated_at = new Date().toISOString();
      return id
        ? base44.entities.TCMOutlook.update(id, rest)
        : base44.entities.TCMOutlook.create(rest);
    },
    // Optimistic update: write the new/updated outlook to the cache immediately
    // so the admin list reflects the change without waiting for the server round-trip.
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ['tcmOutlooks'] });
      const previous = queryClient.getQueryData(['tcmOutlooks']) || [];
      const optimistic = {
        ...data,
        id: data.id || `optimistic-${Date.now()}`,
        _optimistic: true,
      };
      const next = data.id
        ? previous.map(o => (o.id === data.id ? { ...o, ...optimistic } : o))
        : [optimistic, ...previous];
      queryClient.setQueryData(['tcmOutlooks'], next);
      // Sync to localStorage immediately for persistence across tabs/reloads
      try { localStorage.setItem(OUTLOOKS_CACHE_KEY, JSON.stringify(next)); } catch {}
      // Close the editor right away so the UI feels instant
      setEditing(null);
      setShowMap(false);
      return { previous };
    },
    onError: (_err, _data, ctx) => {
      // Roll back to the previous list if the server rejected the change
      if (ctx?.previous) queryClient.setQueryData(['tcmOutlooks'], ctx.previous);
      toast.error('Failed to save graphic');
    },
    onSuccess: () => {
      toast.success('Graphic saved successfully!');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tcmOutlooks'] });
      // Sync cache after server confirms
      queryClient.fetchQuery({ queryKey: ['tcmOutlooks'] }).then(list => {
        try { localStorage.setItem(OUTLOOKS_CACHE_KEY, JSON.stringify(list)); } catch {}
      }).catch(() => {});
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TCMOutlook.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['tcmOutlooks'] });
      const previous = queryClient.getQueryData(['tcmOutlooks']) || [];
      const next = previous.filter(o => o.id !== id);
      queryClient.setQueryData(['tcmOutlooks'], next);
      try { localStorage.setItem(OUTLOOKS_CACHE_KEY, JSON.stringify(next)); } catch {}
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['tcmOutlooks'], ctx.previous);
        try { localStorage.setItem(OUTLOOKS_CACHE_KEY, JSON.stringify(ctx.previous)); } catch {}
      }
      toast.error('Failed to delete');
    },
    onSuccess: () => { toast.success('Deleted'); },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tcmOutlooks'] });
    },
  });

  const handleUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setEditing(prev => ({ ...prev, image_url: file_url }));
    setUploading(false);
  };

  const closeEditor = () => { setEditing(null); setShowMap(false); };

  const openEdit = (o) => {
    setEditing({
      ...o,
      outlook_date: o.outlook_date || '',
      risk_levels: o.risk_levels || (o.risk_level ? [o.risk_level] : []),
      risk_areas: o.risk_areas || [],
      thunderstorm_risks: o.thunderstorm_risks || {},
      is_today:    !!o.is_today,
      is_tomorrow: !!o.is_tomorrow,
      is_two_day:  !!o.is_two_day,
      is_upcoming: !!o.is_upcoming,
      is_archived: !!o.is_archived,
      description: o.description || '',
      overall_risk: o.overall_risk || '',
      peak_24h: o.peak_24h?.length === 8 ? o.peak_24h : DEFAULT_PEAK_24H,
      peak_window: o.peak_window || '',
      thunderstorm_overview: o.thunderstorm_overview || '',
      show_auto_outlook: !!o.show_auto_outlook,
      show_high_res: !!o.show_high_res,
      forecast_type: o.forecast_type || 'initial',
      update_number: o.update_number || null,
    });
    setShowMap(false);
  };

  // Mutually-exclusive day flag setter
  const setDayFlag = (flag) => {
    const all = { is_today: false, is_tomorrow: false, is_two_day: false, is_upcoming: false };
    setEditing(p => ({ ...p, ...all, [flag]: !p[flag] }));
  };

  if (isLoading && outlooks.length === 0) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-sky-500" /></div>;

  return (
    <div className="space-y-6">
      {/* TCM Page Logo */}
      <Card className="p-4 border-purple-200 bg-purple-50">
        <h4 className="font-semibold text-slate-800 text-sm mb-3">TCM Page Logo</h4>
        <div className="flex items-center gap-4">
          {siteSettings?.tcm_logo_url ? (
            <div className="flex items-center gap-3">
              <img src={siteSettings.tcm_logo_url} alt="TCM Logo" className="h-16 object-contain rounded-lg border border-slate-200 bg-white p-1" />
              <div className="space-y-1">
                <label className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-lg cursor-pointer transition-colors">
                  {logoUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                  Replace
                  <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
                </label>
                <button onClick={() => logoMutation.mutate('')} className="text-xs text-red-500 hover:underline">Remove</button>
              </div>
            </div>
          ) : (
            <label className="flex items-center justify-center h-20 w-48 border-2 border-dashed border-purple-300 rounded-xl cursor-pointer hover:border-purple-500 transition-colors">
              {logoUploading ? <Loader2 className="w-5 h-5 text-purple-500 animate-spin" /> : (
                <div className="text-center"><Upload className="w-4 h-4 text-slate-400 mx-auto" /><span className="text-xs text-slate-500 mt-1 block">Upload TCM logo</span></div>
              )}
              <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
            </label>
          )}
        </div>
      </Card>

      {/* Header + New button */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900">TCM Outlooks</h3>
        <Button onClick={() => { setEditing({ ...empty }); setShowMap(false); }} className="bg-purple-600 hover:bg-purple-700 gap-2">
          <Plus className="w-4 h-4" /> New Outlook
        </Button>
      </div>

      {/* ── Editor ──────────────────────────────────────────────────────── */}
      {editing && (
        <Card className="p-5 border-purple-300 bg-purple-50 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-slate-800">{editing.id ? 'Edit Outlook' : 'New Outlook'}</h4>
            <button onClick={closeEditor} className="p-1 hover:text-red-500"><X className="w-4 h-4" /></button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Title *</Label>
              <Input value={editing.title} onChange={e => setEditing(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Thursday Thunderstorm Outlook" />
            </div>
            <div className="space-y-1">
              <Label>Date *</Label>
              <Input type="date" value={editing.outlook_date} onChange={e => setEditing(p => ({ ...p, outlook_date: e.target.value }))} required />
              <p className="text-xs text-slate-400">Required — each outlook must be tied to a specific date.</p>
            </div>

            {/* ── Forecast Type: Initial / Update ── */}
            <div className="sm:col-span-2 space-y-2">
              <Label>Forecast Type</Label>
              <div className="flex flex-wrap gap-3 items-center">
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="radio" name="forecast_type" value="initial"
                    checked={(editing.forecast_type || 'initial') === 'initial'}
                    onChange={() => setEditing(p => ({ ...p, forecast_type: 'initial', update_number: null }))}
                    className="accent-sky-500"
                  />
                  <span className="font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-2.5 py-1 rounded-full text-xs">Initial Forecast</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="radio" name="forecast_type" value="update"
                    checked={editing.forecast_type === 'update'}
                    onChange={() => setEditing(p => ({ ...p, forecast_type: 'update', update_number: p.update_number || 1 }))}
                    className="accent-orange-500"
                  />
                  <span className="font-semibold text-orange-700 bg-orange-50 border border-orange-200 px-2.5 py-1 rounded-full text-xs">Update</span>
                </label>
                {editing.forecast_type === 'update' && (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-slate-500">Update #</Label>
                    <Input
                      type="number" min="1" max="99"
                      value={editing.update_number || ''}
                      onChange={e => setEditing(p => ({ ...p, update_number: e.target.value ? Number(e.target.value) : null }))}
                      className="w-20 text-sm"
                      placeholder="1"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Risk Level(s) — now includes No Risk */}
            <div className="space-y-1">
              <Label>Risk Level(s) <span className="text-slate-400 font-normal text-xs">(select multiple for a range)</span></Label>
              <div className="flex flex-wrap gap-1.5">
                {RISK_LEVELS.map(l => {
                  const selected = (editing.risk_levels || []).includes(l);
                  return (
                    <button key={l} type="button"
                      onClick={() => setEditing(p => {
                        const cur = p.risk_levels || [];
                        // "No Risk" is exclusive — selecting it clears other selections
                        let next;
                        if (l === 'No Risk') {
                          next = selected ? [] : ['No Risk'];
                        } else {
                          const withoutNoRisk = cur.filter(x => x !== 'No Risk');
                          next = withoutNoRisk.includes(l) ? withoutNoRisk.filter(x => x !== l) : [...withoutNoRisk, l];
                        }
                        return {
                          ...p,
                          risk_levels: next,
                          risk_level: next.length === 1 ? next[0] : (next.length === 0 ? '' : p.risk_level),
                        };
                      })}
                      className={`px-2.5 py-1 rounded-full text-xs font-bold border-2 transition-all ${selected ? (RISK_STYLES[l] || 'border-slate-400 text-slate-400') + ' bg-white' : 'border-slate-300 text-slate-500'}`}
                    >
                      {selected && <Check className="w-2.5 h-2.5 inline mr-1" />}{l}
                    </button>
                  );
                })}
              </div>
              {(editing.risk_levels || []).length > 0 && (
                <p className="text-xs text-purple-600 font-medium mt-1">→ {getRiskRange(editing.risk_levels)}</p>
              )}
            </div>

            {/* ── Day Flags: Today / Tomorrow / 2 Day / Upcoming (3rd day) ── */}
            <div className="space-y-2">
              <Label>Day Label</Label>
              <p className="text-xs text-slate-400">Only one label can be active at a time. "Upcoming" graphics are hidden from the public TCM page until promoted to 2 Day.</p>
              <div className="flex flex-wrap gap-4">
                {[
                  { flag: 'is_today',    label: "Today's",          color: 'sky' },
                  { flag: 'is_tomorrow', label: "Tomorrow's",       color: 'blue' },
                  { flag: 'is_two_day',  label: '2 Day',            color: 'indigo' },
                  { flag: 'is_upcoming', label: '3rd Day (Upcoming)', color: 'violet' },
                ].map(({ flag, label, color }) => (
                  <label key={flag} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <Switch
                      checked={!!editing[flag]}
                      onCheckedChange={() => setDayFlag(flag)}
                    />
                    <span className={`text-${color}-700 font-medium`}>{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="sm:col-span-2 space-y-1">
              <Label>Summary</Label>
              <RichTextEditor
                value={editing.summary}
                onChange={(html) => setEditing(p => ({ ...p, summary: html }))}
                placeholder="Brief outlook summary..."
                rows={2}
              />
            </div>

            {/* ── Description ── */}
            <div className="sm:col-span-2 space-y-1">
              <Label>Description <span className="text-slate-400 font-normal text-xs">(detailed narrative shown to all users)</span></Label>
              <RichTextEditor
                value={editing.description || ''}
                onChange={(html) => setEditing(p => ({ ...p, description: html }))}
                placeholder="Full outlook description..."
                rows={4}
              />
            </div>

            {/* ── Overall Risk narrative ── */}
            <div className="sm:col-span-2 space-y-1">
              <Label>Overall Risk <span className="text-slate-400 font-normal text-xs">(brief risk summary sentence)</span></Label>
              <Textarea
                value={editing.overall_risk || ''}
                onChange={e => setEditing(p => ({ ...p, overall_risk: e.target.value }))}
                rows={2}
                placeholder="e.g. Marginal to Moderate risk across central England, with isolated High risk possible..."
              />
            </div>

            {/* ── Peak Window ── */}
            <div className="space-y-1">
              <Label>Peak Window <span className="text-slate-400 font-normal text-xs">(time range)</span></Label>
              <Input
                value={editing.peak_window || ''}
                onChange={e => setEditing(p => ({ ...p, peak_window: e.target.value }))}
                placeholder="e.g. 14:00 – 20:00"
              />
            </div>

            {/* ── Thunderstorm Overview ── */}
            <div className="space-y-1">
              <Label>Thunderstorm Overview</Label>
              <Textarea
                value={editing.thunderstorm_overview || ''}
                onChange={e => setEditing(p => ({ ...p, thunderstorm_overview: e.target.value }))}
                rows={2}
                placeholder="Thunderstorm specific notes..."
              />
            </div>

            {/* ── 24-Hour Peak at 3h intervals ── */}
            <div className="sm:col-span-2 space-y-2">
              <Label>24-Hour Peak Activity <span className="text-slate-400 font-normal text-xs">(3-hour intervals)</span></Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(editing.peak_24h || DEFAULT_PEAK_24H).map((slot, i) => (
                  <div key={slot.time} className="bg-slate-900/40 rounded-xl p-2.5 border border-slate-700/50 space-y-1.5">
                    <p className="text-xs font-bold text-purple-300">{slot.time} <span className="text-slate-500 font-normal">({slot.label})</span></p>
                    <select
                      value={slot.risk_level}
                      onChange={e => setEditing(p => {
                        const arr = [...(p.peak_24h || DEFAULT_PEAK_24H)];
                        arr[i] = { ...arr[i], risk_level: e.target.value };
                        return { ...p, peak_24h: arr };
                      })}
                      className="w-full text-xs rounded-lg border border-slate-600 bg-slate-800 text-white px-2 py-1 focus:border-purple-400 focus:outline-none"
                    >
                      {RISK_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                    <div className="space-y-0.5">
                      <div className="flex justify-between">
                        <span className="text-[10px] text-slate-400">Activity</span>
                        <span className="text-[10px] font-bold text-purple-300">{slot.activity}%</span>
                      </div>
                      <input
                        type="range" min="0" max="100" step="5"
                        value={slot.activity}
                        onChange={e => setEditing(p => {
                          const arr = [...(p.peak_24h || DEFAULT_PEAK_24H)];
                          arr[i] = { ...arr[i], activity: Number(e.target.value) };
                          return { ...p, peak_24h: arr };
                        })}
                        className="w-full h-1.5 accent-purple-500 cursor-pointer"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Auto-generated outlook toggles ── */}
            <div className="sm:col-span-2 space-y-3">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Auto-Generated Outlooks</p>
              <label className="flex items-center gap-3 cursor-pointer">
                <Switch
                  checked={!!editing.show_auto_outlook}
                  onCheckedChange={v => setEditing(p => ({ ...p, show_auto_outlook: v }))}
                />
                <div>
                  <span className="text-sm font-medium text-slate-700">Show Auto-Generated Outlook</span>
                  <p className="text-xs text-slate-400">Display the auto-generated TCM outlook panel to all users on this graphic.</p>
                </div>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <Switch
                  checked={!!editing.show_high_res}
                  onCheckedChange={v => setEditing(p => ({ ...p, show_high_res: v }))}
                />
                <div>
                  <span className="text-sm font-medium text-slate-700">Show Auto-Generated High Resolution</span>
                  <p className="text-xs text-slate-400">Display the high-resolution auto-generated outlook panel to all users.</p>
                </div>
              </label>
            </div>

            {editing.id && (
              <div className="sm:col-span-2 space-y-1">
                <Label>Update Reason <span className="text-slate-400 font-normal">(optional — shown on graphic)</span></Label>
                <Textarea value={editing.update_reason || ''} onChange={e => setEditing(p => ({ ...p, update_reason: e.target.value }))} rows={2} placeholder="e.g. Amended risk area for East Midlands..." />
              </div>
            )}

            <div className="sm:col-span-2 space-y-1">
              <Label>Graphic Image</Label>
              {editing.image_url ? (
                <div className="relative inline-block">
                  <img src={editing.image_url} alt="Preview" className="h-32 object-contain rounded-lg border border-slate-200" />
                  <Button size="icon" variant="destructive" className="absolute -top-2 -right-2 h-6 w-6" onClick={() => setEditing(p => ({ ...p, image_url: '' }))}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <label className="flex items-center justify-center h-24 border-2 border-dashed border-purple-300 rounded-xl cursor-pointer hover:border-purple-500 transition-colors">
                  {uploading ? <Loader2 className="w-6 h-6 text-purple-500 animate-spin" /> : (
                    <div className="text-center"><Upload className="w-5 h-5 text-slate-400 mx-auto" /><span className="text-xs text-slate-500">Upload outlook graphic</span></div>
                  )}
                  <input type="file" className="hidden" accept="image/*" onChange={handleUpload} />
                </label>
              )}
            </div>

            <div className="sm:col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <Label>Risk Impact Areas</Label>
                <button type="button" onClick={() => setShowMap(v => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-purple-600 hover:text-purple-800 transition-colors">
                  <Map className="w-3.5 h-3.5" />
                  {showMap ? 'Hide Map' : editing.risk_areas?.length > 0 ? `Edit Areas (${editing.risk_areas.length})` : 'Draw on Map'}
                </button>
              </div>
              {showMap && (
                <RiskAreaMap
                  areas={editing.risk_areas || []}
                  onChange={(updater) => setEditing(p => ({
                    ...p,
                    risk_areas: typeof updater === 'function' ? updater(p.risk_areas || []) : updater,
                  }))}
                />
              )}
              {!showMap && editing.risk_areas?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {editing.risk_areas.map((area, i) => {
                    const { fill, stroke } = RISK_COLORS[area.risk_level] || {};
                    return (
                      <span key={area.id || i} className="text-xs font-bold px-2.5 py-1 rounded-full border-2"
                        style={{ borderColor: stroke, background: fill, color: '#1e293b' }}>
                        {area.risk_level} Area {i + 1}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="sm:col-span-2">
              <ThunderstormPanel
                data={editing.thunderstorm_risks || {}}
                onChange={(updated) => setEditing(p => ({ ...p, thunderstorm_risks: updated }))}
              />
            </div>

            {/* Manual archive toggle */}
            <div className="sm:col-span-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <Switch
                  checked={!!editing.is_archived}
                  onCheckedChange={v => setEditing(p => ({ ...p, is_archived: v }))}
                />
                <div>
                  <span className="text-sm font-medium text-slate-700">Mark as Archived</span>
                  <p className="text-xs text-slate-400">Archived graphics are hidden from the public TCM page.</p>
                </div>
              </label>
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={closeEditor} className="flex-1">Cancel</Button>
            <Button
              onClick={() => saveMutation.mutate(editing)}
              disabled={saveMutation.isPending || !editing.title || !editing.outlook_date}
              className="flex-1 bg-purple-600 hover:bg-purple-700"
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {editing.id ? 'Save Changes' : 'Save Graphic'}
            </Button>
          </div>
        </Card>
      )}

      {/* ── Live Graphics ────────────────────────────────────────────── */}
      <div className="space-y-2">
        <SectionHeader
          icon={<Radio className="w-4 h-4" />}
          label="Live Graphics"
          count={liveOutlooks.length}
          color="#0369a1"
          bgColor="rgba(186,230,253,0.35)"
          borderColor="rgba(125,211,252,0.5)"
          open={liveOpen}
          onToggle={() => setLiveOpen(v => !v)}
        />
        {liveOpen && (
          <div className="space-y-2 pl-1">
            {liveOutlooks.length === 0 && (
              <p className="text-sm text-slate-400 italic text-center py-4">No live graphics</p>
            )}
            {liveOutlooks.map(o => (
              <OutlookRow
                key={o.id}
                o={o}
                onEdit={openEdit}
                onDelete={(id) => deleteMutation.mutate(id)}
                deletePending={deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Upcoming (3rd day) ───────────────────────────────────────── */}
      <div className="space-y-2">
        <SectionHeader
          icon={<Clock className="w-4 h-4" />}
          label="Upcoming (3rd Day — Hidden from TCM page)"
          count={upcomingOutlooks.length}
          color="#7c3aed"
          bgColor="rgba(221,214,254,0.25)"
          borderColor="rgba(196,181,253,0.45)"
          open={upcomingOpen}
          onToggle={() => setUpcomingOpen(v => !v)}
        />
        {upcomingOpen && (
          <div className="space-y-2 pl-1">
            {upcomingOutlooks.length === 0 && (
              <p className="text-sm text-slate-400 italic text-center py-4">No upcoming graphics scheduled</p>
            )}
            {upcomingOutlooks.map(o => (
              <OutlookRow
                key={o.id}
                o={o}
                onEdit={openEdit}
                onDelete={(id) => deleteMutation.mutate(id)}
                deletePending={deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Archived ─────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <SectionHeader
          icon={<Archive className="w-4 h-4" />}
          label="Archived Graphics"
          count={archivedOutlooks.length}
          color="#64748b"
          bgColor="rgba(241,245,249,0.6)"
          borderColor="rgba(203,213,225,0.7)"
          open={archivedOpen}
          onToggle={() => setArchivedOpen(v => !v)}
        />
        {archivedOpen && (
          <div className="space-y-2 pl-1">
            {archivedOutlooks.length === 0 && (
              <p className="text-sm text-slate-400 italic text-center py-4">No archived graphics yet</p>
            )}
            {archivedOutlooks.map(o => (
              <OutlookRow
                key={o.id}
                o={o}
                onEdit={openEdit}
                onDelete={(id) => deleteMutation.mutate(id)}
                deletePending={deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}