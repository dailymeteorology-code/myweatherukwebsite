import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Pencil, Trash2, Star, StarOff, FileDown, Loader2, Flag, MapPin } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { format } from 'date-fns';
import { exportGraphicAsPDF } from '@/lib/exportGraphicPDF';

const IMPACT_COLOR = {
  Low:      '#22c55e',
  SLGT:     '#eab308',
  Moderate: '#f97316',
  High:     '#ef4444',
};

const LOC_RISK_COLORS = {
  'Very Low': '#86efac',
  Low:        '#bbf7d0',
  Marginal:   '#fde047',
  Slight:     '#fdba74',
  Moderate:   '#fca5a5',
  High:       '#d8b4fe',
  Severe:     '#f8fafc',
};

function normalizeList(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); if (Array.isArray(p)) return p.filter(Boolean); } catch (_) {}
    return v.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function normalizeLocations(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(l => typeof l === 'string' ? { name: l } : l);
  }
  return [];
}

export default function GraphicCard({ graphic, onEdit, onDelete, onToggleFeatured, index }) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try { await exportGraphicAsPDF(graphic); }
    finally { setExporting(false); }
  };

  const subs = normalizeList(graphic.condition_subtypes);
  const locs = normalizeLocations(graphic.locations_impacted);
  const impactColor = IMPACT_COLOR[graphic.impact_level];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.05 }}
      className="group relative bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300"
    >
      {/* Initial forecast ribbon */}
      {graphic.is_initial_forecast && (
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-600/90 backdrop-blur text-white text-[10px] font-bold shadow">
          <Flag className="w-2.5 h-2.5" /> Initial Forecast
        </div>
      )}

      <div className="aspect-video overflow-hidden">
        <img
          src={graphic.image_url}
          alt={graphic.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
      </div>

      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-2 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-300">
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => onEdit(graphic)} className="flex-1">
            <Pencil className="w-4 h-4 mr-1" /> Edit
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onToggleFeatured(graphic)}
            title={graphic.is_featured ? 'Unfeature' : 'Feature'}>
            {graphic.is_featured ? <StarOff className="w-4 h-4" /> : <Star className="w-4 h-4" />}
          </Button>
          <Button size="sm" variant="secondary" onClick={handleExport} disabled={exporting} title="Export as PDF">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => onDelete(graphic.id)} title="Delete">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-slate-800 line-clamp-1">{graphic.title}</h3>
          {graphic.is_featured && <Star className="w-4 h-4 text-amber-500 fill-amber-500 flex-shrink-0" />}
        </div>

        {/* Impact badge */}
        {graphic.impact_level && impactColor && (
          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border"
            style={{ color: impactColor, borderColor: `${impactColor}55`, background: `${impactColor}15` }}>
            {graphic.impact_level}
          </span>
        )}

        {/* Condition subtypes */}
        {subs.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {subs.slice(0, 3).map(s => (
              <span key={s} className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-slate-100 border border-slate-200 text-slate-500">
                {s}
              </span>
            ))}
            {subs.length > 3 && <span className="text-[9px] text-slate-400">+{subs.length - 3} more</span>}
          </div>
        )}

        {/* Locations with risk */}
        {locs.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {locs.slice(0, 2).map(loc => {
              const display = loc.highest_risk || loc.overall_risk;
              const col = display ? LOC_RISK_COLORS[display] : null;
              return (
                <span key={loc.name} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-[10px] text-slate-600">
                  <MapPin className="w-2.5 h-2.5 text-slate-400" />
                  {loc.name}
                  {display && (
                    <span className="font-bold" style={{ color: col }}>{display}</span>
                  )}
                </span>
              );
            })}
            {locs.length > 2 && <span className="text-[9px] text-slate-400">+{locs.length - 2}</span>}
          </div>
        )}

        {graphic.description && (
          <p className="text-sm text-slate-500 line-clamp-2">{graphic.description}</p>
        )}
        <p className="text-xs text-slate-400">
          {format(new Date(graphic.created_date), 'MMM d, yyyy · h:mm a')}
        </p>
      </div>
    </motion.div>
  );
}