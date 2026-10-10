import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import RichTextEditor from '@/components/RichTextEditor';
import MobileSelect from '@/components/MobileSelect';
import { Switch } from "@/components/ui/switch";
import { Upload, X, Loader2, MapPin, Plus, Check, ChevronDown, Flag, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';

// ── Constants ────────────────────────────────────────────────────────────────

const IMPACT_LEVELS = ['Low', 'SLGT', 'Moderate', 'High'];
const IMPACT_CONFIG = {
  Low:      { active: 'bg-green-500 text-white border-green-500',   inactive: 'border-green-500/50 text-green-400 hover:bg-green-500/10' },
  SLGT:     { active: 'bg-yellow-500 text-slate-900 border-yellow-500', inactive: 'border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10' },
  Moderate: { active: 'bg-orange-500 text-white border-orange-500', inactive: 'border-orange-500/50 text-orange-400 hover:bg-orange-500/10' },
  High:     { active: 'bg-red-500 text-white border-red-500',       inactive: 'border-red-500/50 text-red-400 hover:bg-red-500/10' },
};

const CONDITIONS = ['Snow', 'Ice', 'Thunderstorms', 'Rain', 'Wind', 'Heat', 'Daily Risks'];
const CONDITION_SUBTYPES = {
  Snow:          ['Light Snow', 'Heavy Snow', 'Snow Showers', 'Sleet', 'Blizzard', 'Drifting Snow', 'Snow & Ice Mix'],
  Ice:           ['Ice on Untreated Surfaces', 'Black Ice', 'Freezing Rain', 'Hard Frost', 'Icy Patches', 'Glaze Ice'],
  Thunderstorms: ['Thundery Shower', 'Isolated Thunderstorm', 'Scattered Thunderstorms', 'Severe Thunderstorm', 'Embedded Thunderstorms', 'Frequent Lightning'],
  Rain:          ['Light Rain', 'Heavy Rain', 'Persistent Rain', 'Showers', 'Heavy Showers', 'Localised Flooding', 'Thundery Rain'],
  Wind:          ['Gusty Winds', 'Gale', 'Severe Gale', 'Storm Force', 'Coastal Gusts', 'Hill Gusts', 'Damaging Gusts'],
  Heat:          ['Warm Spell', 'Hot Day', 'Heatwave', 'Extreme Heat', 'Tropical Night', 'Elevated UV'],
  'Daily Risks': ['Fog', 'Dense Fog', 'Mist', 'Hail', 'Lightning Risk', 'Low Visibility', 'Surface Water', 'Travel Disruption'],
};

const COND_COLOR = {
  Snow: { bg: 'rgba(56,189,248,0.1)', border: 'rgba(56,189,248,0.35)', text: '#7dd3fc' },
  Ice:  { bg: 'rgba(34,211,238,0.1)', border: 'rgba(34,211,238,0.35)', text: '#67e8f9' },
  Thunderstorms: { bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.35)', text: '#c084fc' },
  Rain:  { bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.35)', text: '#60a5fa' },
  Wind:  { bg: 'rgba(45,212,191,0.1)', border: 'rgba(45,212,191,0.35)', text: '#2dd4bf' },
  Heat:  { bg: 'rgba(251,146,60,0.1)', border: 'rgba(251,146,60,0.35)', text: '#fb923c' },
  'Daily Risks': { bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.35)', text: '#fbbf24' },
};

const LOC_RISK_LEVELS = ['None', 'Very Low', 'Low', 'Marginal', 'Slight', 'Moderate', 'High', 'Severe'];
const LOC_RISK_COLORS = {
  None:     '#64748b',
  'Very Low': '#86efac',
  Low:      '#bbf7d0',
  Marginal: '#fde047',
  Slight:   '#fdba74',
  Moderate: '#fca5a5',
  High:     '#d8b4fe',
  Severe:   '#f8fafc',
};

// ── Location entry with risk levels ─────────────────────────────────────────

function LocationEntry({ loc, onRemove, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        <span className="text-sm text-slate-700 flex-1 font-medium">{loc.name}</span>
        <button type="button" onClick={() => setOpen(v => !v)}
          className="text-xs text-slate-400 hover:text-slate-600 px-2 py-0.5 rounded border border-slate-200 hover:border-slate-300 transition-colors flex items-center gap-1">
          Risk <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <button type="button" onClick={onRemove} className="hover:text-red-500 text-slate-400 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {open && (
        <div className="grid grid-cols-1 gap-2 pt-1">
          {/* Overall risk */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Overall Risk</p>
            <div className="flex flex-wrap gap-1">
              {LOC_RISK_LEVELS.map(level => (
                <button key={level} type="button"
                  onClick={() => onChange({ ...loc, overall_risk: level === 'None' ? null : level })}
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all"
                  style={{
                    background: loc.overall_risk === level ? `${LOC_RISK_COLORS[level]}22` : 'transparent',
                    borderColor: loc.overall_risk === level ? LOC_RISK_COLORS[level] : 'rgba(0,0,0,0.12)',
                    color: loc.overall_risk === level ? LOC_RISK_COLORS[level] : '#64748b',
                  }}>
                  {level}
                </button>
              ))}
            </div>
          </div>
          {/* OR separate high/low */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 mb-1">Lowest Risk</p>
              <div className="flex flex-wrap gap-1">
                {LOC_RISK_LEVELS.filter(l => l !== 'None').map(level => (
                  <button key={level} type="button"
                    onClick={() => onChange({ ...loc, lowest_risk: loc.lowest_risk === level ? null : level })}
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all"
                    style={{
                      background: loc.lowest_risk === level ? `${LOC_RISK_COLORS[level]}22` : 'transparent',
                      borderColor: loc.lowest_risk === level ? LOC_RISK_COLORS[level] : 'rgba(0,0,0,0.12)',
                      color: loc.lowest_risk === level ? LOC_RISK_COLORS[level] : '#94a3b8',
                    }}>
                    {level}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-red-500 mb-1">Highest Risk</p>
              <div className="flex flex-wrap gap-1">
                {LOC_RISK_LEVELS.filter(l => l !== 'None').map(level => (
                  <button key={level} type="button"
                    onClick={() => onChange({ ...loc, highest_risk: loc.highest_risk === level ? null : level })}
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all"
                    style={{
                      background: loc.highest_risk === level ? `${LOC_RISK_COLORS[level]}22` : 'transparent',
                      borderColor: loc.highest_risk === level ? LOC_RISK_COLORS[level] : 'rgba(0,0,0,0.12)',
                      color: loc.highest_risk === level ? LOC_RISK_COLORS[level] : '#94a3b8',
                    }}>
                    {level}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main form ────────────────────────────────────────────────────────────────

function normalizeLocations(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(l =>
      typeof l === 'string'
        ? { name: l, overall_risk: null, highest_risk: null, lowest_risk: null }
        : l
    );
  }
  return [];
}

export default function GraphicForm({ graphic, existingGraphics = [], onSubmit, onCancel, isLoading }) {
  const buildInitialState = (g) => ({
    title:              g?.title || '',
    description:        g?.description || '',
    image_url:          g?.image_url || '',
    is_featured:        g?.is_featured || false,
    published:          g?.published !== false,
    impact_level:       g?.impact_level || '',
    impact_levels:      g?.impact_levels
                          ? (Array.isArray(g.impact_levels) ? g.impact_levels : [g.impact_levels])
                          : (g?.impact_level ? [g.impact_level] : []),
    in_force_from:      g?.in_force_from ? g.in_force_from.slice(0, 16) : '',
    expires_at:         g?.expires_at ? g.expires_at.slice(0, 16) : '',
    locations_impacted: normalizeLocations(g?.locations_impacted),
    weather_conditions: g?.weather_conditions
                          ? (Array.isArray(g.weather_conditions) ? g.weather_conditions : [g.weather_conditions])
                          : (g?.weather_condition ? [g.weather_condition] : []),
    condition_subtypes: g?.condition_subtypes
                          ? (Array.isArray(g.condition_subtypes) ? g.condition_subtypes : [])
                          : [],
    is_initial_forecast: g?.is_initial_forecast ?? false,
    is_continuation:     false,
    parent_graphic_id:   null,
    update_reason:       '',
  });

  const [formData, setFormData] = useState(() => buildInitialState(graphic));
  const [uploading, setUploading] = useState(false);
  const [locationInput, setLocationInput] = useState('');

  // Re-populate every field whenever the graphic being edited changes —
  // useState initialiser only runs once so without this the form stays
  // stale when the user switches from "Add" → "Edit" or edits a different graphic.
  useEffect(() => {
    setFormData(buildInitialState(graphic));
    setLocationInput('');
  // graphic?.id changing (or going undefined→id for new graphics) is the right trigger
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphic?.id]);

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setFormData(prev => ({ ...prev, image_url: file_url }));
    setUploading(false);
  };

  const toggleCondition = (c) => {
    setFormData(prev => {
      const has = prev.weather_conditions.includes(c);
      const next = has
        ? prev.weather_conditions.filter(x => x !== c)
        : [...prev.weather_conditions, c];
      // drop subtypes for removed condition
      const dropSet = new Set(CONDITION_SUBTYPES[c] || []);
      const subs = has
        ? prev.condition_subtypes.filter(s => !dropSet.has(s))
        : prev.condition_subtypes;
      return { ...prev, weather_conditions: next, condition_subtypes: subs };
    });
  };

  const toggleSubtype = (s) => {
    setFormData(prev => ({
      ...prev,
      condition_subtypes: prev.condition_subtypes.includes(s)
        ? prev.condition_subtypes.filter(x => x !== s)
        : [...prev.condition_subtypes, s],
    }));
  };

  const addLocation = () => {
    const val = locationInput.trim();
    if (!val) return;
    const alreadyExists = formData.locations_impacted.some(l => l.name === val);
    if (alreadyExists) return;
    setFormData(prev => ({
      ...prev,
      locations_impacted: [
        ...prev.locations_impacted,
        { name: val, overall_risk: null, highest_risk: null, lowest_risk: null },
      ],
    }));
    setLocationInput('');
  };

  const removeLocation = (name) => {
    setFormData(prev => ({
      ...prev,
      locations_impacted: prev.locations_impacted.filter(l => l.name !== name),
    }));
  };

  const updateLocation = (name, updated) => {
    setFormData(prev => ({
      ...prev,
      locations_impacted: prev.locations_impacted.map(l => l.name === name ? updated : l),
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      in_force_from:  formData.in_force_from || null,
      expires_at:     formData.expires_at || null,
      impact_level:   formData.impact_levels.length === 1
        ? formData.impact_levels[0]
        : (formData.impact_levels.length > 1 ? formData.impact_levels[formData.impact_levels.length - 1] : null),
      impact_levels:      formData.impact_levels,
      weather_condition:  formData.weather_conditions[0] ?? null,
      weather_conditions: formData.weather_conditions,
      condition_subtypes: formData.condition_subtypes,
      update_reason:      formData.update_reason || null,
      is_initial_forecast: formData.is_initial_forecast,
      is_continuation:    formData.is_continuation,
      parent_graphic_id:  formData.is_continuation ? formData.parent_graphic_id : null,
    });
  };

  // Conditions with subtypes available that are currently selected
  const activeConditionsWithSubs = formData.weather_conditions.filter(
    c => CONDITION_SUBTYPES[c]?.length > 0
  );

  // For continuation dropdown — show non-archived active graphics (not self)
  const continuationCandidates = existingGraphics.filter(
    g => !g.is_archived && g.id !== graphic?.id
  );

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-5">
        {/* ── Left column ─────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              placeholder="e.g., Storm Warning Graphic" required />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>Description</Label>
            <RichTextEditor
              value={formData.description}
              onChange={(html) => setFormData(prev => ({ ...prev, description: html }))}
              placeholder="Add a caption or details..."
              rows={2}
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="in_force_from">In Force From</Label>
              <Input id="in_force_from" type="datetime-local" value={formData.in_force_from}
                onChange={(e) => setFormData(prev => ({ ...prev, in_force_from: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expires_at">Expires At</Label>
              <Input id="expires_at" type="datetime-local" value={formData.expires_at}
                onChange={(e) => setFormData(prev => ({ ...prev, expires_at: e.target.value }))} />
            </div>
          </div>

          {/* Impact level */}
          <div className="space-y-2">
            <Label>Impact Level <span className="text-slate-400 font-normal">(select all that apply)</span></Label>
            <div className="flex flex-wrap gap-2">
              {IMPACT_LEVELS.map(level => {
                const cfg = IMPACT_CONFIG[level];
                const sel = formData.impact_levels.includes(level);
                return (
                  <button key={level} type="button"
                    onClick={() => setFormData(prev => ({
                      ...prev,
                      impact_levels: sel
                        ? prev.impact_levels.filter(l => l !== level)
                        : [...prev.impact_levels, level],
                    }))}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 text-xs font-bold transition-all ${sel ? cfg.active : cfg.inactive}`}>
                    {sel && <Check className="w-3.5 h-3.5" />}{level}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Weather conditions */}
          <div className="space-y-2">
            <Label>Weather Conditions <span className="text-slate-400 font-normal">(select all that apply)</span></Label>
            <div className="flex flex-wrap gap-1.5">
              {CONDITIONS.map(c => {
                const cfg = COND_COLOR[c];
                const sel = formData.weather_conditions.includes(c);
                return (
                  <button key={c} type="button" onClick={() => toggleCondition(c)}
                    className="px-3 py-1.5 rounded-full text-xs font-bold border transition-all"
                    style={{
                      background:  sel ? cfg.bg    : 'transparent',
                      borderColor: sel ? cfg.border : 'rgba(0,0,0,0.15)',
                      color:       sel ? cfg.text   : '#94a3b8',
                    }}>
                    {c}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subtypes for each active condition */}
          {activeConditionsWithSubs.map(c => {
            const cfg = COND_COLOR[c];
            return (
              <div key={c} className="rounded-xl p-3 space-y-2"
                style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: cfg.text }}>
                  {c} — further detail
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {CONDITION_SUBTYPES[c].map(s => {
                    const sel = formData.condition_subtypes.includes(s);
                    return (
                      <button key={s} type="button" onClick={() => toggleSubtype(s)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all"
                        style={{
                          background:  sel ? cfg.bg    : 'rgba(255,255,255,0.03)',
                          borderColor: sel ? cfg.border : 'rgba(0,0,0,0.12)',
                          color:       sel ? cfg.text   : '#64748b',
                        }}>
                        {sel && <Check className="w-2.5 h-2.5" />}{s}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Forecast type */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
            <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Forecast Type</p>

            {/* Initial forecast toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flag className="w-4 h-4 text-sky-500" />
                <div>
                  <Label htmlFor="is_initial" className="cursor-pointer text-sm">Initial Forecast</Label>
                  <p className="text-xs text-slate-500">Mark as the first forecast for this event</p>
                </div>
              </div>
              <Switch id="is_initial" checked={formData.is_initial_forecast}
                onCheckedChange={(v) => setFormData(prev => ({
                  ...prev,
                  is_initial_forecast: v,
                  // Mutually exclusive with continuation
                  is_continuation: v ? false : prev.is_continuation,
                  parent_graphic_id: v ? null : prev.parent_graphic_id,
                }))} />
            </div>

            {/* Continuation toggle */}
            {!formData.is_initial_forecast && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-amber-500" />
                    <div>
                      <Label htmlFor="is_continuation" className="cursor-pointer text-sm">Continuation</Label>
                      <p className="text-xs text-slate-500">Updates an existing active graphic (moves it to archive)</p>
                    </div>
                  </div>
                  <Switch id="is_continuation" checked={formData.is_continuation}
                    onCheckedChange={(v) => setFormData(prev => ({
                      ...prev,
                      is_continuation: v,
                      parent_graphic_id: v ? prev.parent_graphic_id : null,
                    }))} />
                </div>

                {formData.is_continuation && continuationCandidates.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Select graphic this continues</Label>
                    <MobileSelect
                      value={formData.parent_graphic_id || ''}
                      onChange={(val) => setFormData(prev => ({ ...prev, parent_graphic_id: val || null }))}
                      label="Select existing graphic"
                      placeholder="— Select existing graphic —"
                      options={continuationCandidates.map(g => ({ value: g.id, label: g.title }))}
                    />
                    <p className="text-[11px] text-amber-600">
                      The selected graphic will be moved to the archive when this one is published.
                    </p>
                  </div>
                )}

                {formData.is_continuation && continuationCandidates.length === 0 && (
                  <p className="text-xs text-slate-500 italic">No active graphics available to continue.</p>
                )}
              </div>
            )}
          </div>

          {/* Update reason (edit mode) */}
          {graphic && (
            <div className="space-y-1.5">
              <Label htmlFor="update_reason">Reason for Update</Label>
              <Textarea id="update_reason" value={formData.update_reason}
                onChange={(e) => setFormData(prev => ({ ...prev, update_reason: e.target.value }))}
                placeholder="e.g. Updated expiry time, revised impact area..." rows={2} />
            </div>
          )}

          {/* Feature toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
            <div>
              <Label htmlFor="featured" className="cursor-pointer">Feature on Homepage</Label>
              <p className="text-xs text-slate-500">Show this graphic prominently</p>
            </div>
            <Switch id="featured" checked={formData.is_featured}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_featured: checked }))} />
          </div>
        </div>

        {/* ── Right column ────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Image */}
          <div className="space-y-1.5">
            <Label>Image *</Label>
            {formData.image_url ? (
              <div className="relative rounded-xl overflow-hidden">
                <img src={formData.image_url} alt="Preview" className="w-full h-44 object-cover" />
                <Button type="button" size="icon" variant="destructive" className="absolute top-2 right-2"
                  onClick={() => setFormData(prev => ({ ...prev, image_url: '' }))}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full h-44 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-sky-500 hover:bg-sky-50/50 transition-colors">
                {uploading ? <Loader2 className="w-8 h-8 text-sky-500 animate-spin" /> : (
                  <>
                    <Upload className="w-7 h-7 text-slate-400 mb-2" />
                    <span className="text-sm text-slate-500">Click to upload image</span>
                  </>
                )}
                <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} disabled={uploading} />
              </label>
            )}
          </div>

          {/* Locations impacted */}
          <div className="space-y-2">
            <Label>Locations Impacted</Label>
            <div className="flex gap-2">
              <Input placeholder="Add a location..." value={locationInput}
                onChange={e => setLocationInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addLocation())} />
              <Button type="button" size="icon" variant="outline" onClick={addLocation}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {formData.locations_impacted.length > 0 && (
              <div className="space-y-2">
                {formData.locations_impacted.map(loc => (
                  <LocationEntry
                    key={loc.name}
                    loc={loc}
                    onRemove={() => removeLocation(loc.name)}
                    onChange={(updated) => updateLocation(loc.name, updated)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-5 mt-5 border-t border-slate-200">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1" disabled={isLoading}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1 bg-sky-600 hover:bg-sky-700"
          disabled={isLoading || !formData.title || !formData.image_url}>
          {isLoading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          {graphic ? 'Update' : 'Add'} Graphic
        </Button>
      </div>
    </form>
  );
}