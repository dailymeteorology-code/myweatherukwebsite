import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, Camera, AlertTriangle, Database, Loader2,
  Eye, EyeOff, Palette,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════
   HISTORICAL LIGHTNING PANEL — Blitzortung archive
   ───────────────────────────────────────────────────────────────
   This version adds:
     • A UK / Europe region toggle that scopes strike rendering,
       day counts, and warning display to the chosen region.
     • A density (heat-map) toggle on the day map.
     • Yesterday's UK strikes are loaded automatically from the
       backend so a quiet next-morning view still has something
       to look at.
     • Admin controls to force a snapshot and to save a whole-day
       snapshot to the database (visible to all users).
   ═══════════════════════════════════════════════════════════════ */

const STRIKE_COLOUR_OPTIONS = [
  { id: 'age',    label: 'Age',    preview: 'linear-gradient(90deg,#fff,#facc15,#f97316,#ef4444,#7c3aed,#4c1d95)' },
  { id: 'yellow', label: 'Yellow', hex: '#facc15' },
  { id: 'white',  label: 'White',  hex: '#ffffff' },
  { id: 'cyan',   label: 'Cyan',   hex: '#22d3ee' },
  { id: 'lime',   label: 'Lime',   hex: '#84cc16' },
  { id: 'pink',   label: 'Pink',   hex: '#f472b6' },
  { id: 'orange', label: 'Orange', hex: '#f97316' },
  { id: 'red',    label: 'Red',    hex: '#ef4444' },
  { id: 'purple', label: 'Purple', hex: '#a78bfa' },
];

/* ── Region geometry — mirrors GEO_BOUNDS_UK / GEO_BOUNDS_EU in TCM.jsx ──── */
const REGION_BBOX = {
  uk:     { latMin: 49.5, latMax: 61.0, lonMin: -10.8, lonMax: 2.5 },
  europe: { latMin: 34.0, latMax: 72.0, lonMin: -25.0, lonMax: 45.0 },
};
const inRegion = (lat, lon, region) => {
  const b = REGION_BBOX[region]; if (!b) return false;
  return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
};

function todayDateStr() { return new Date().toISOString().slice(0, 10); }
function yesterdayDateStr() {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Multi-scale Gaussian KDE heatmap helpers ─────────────────────────────
// Matches the live map heatmap in TCM.jsx exactly.
const KDE_RAMP = [
  { t: 0.0,  r:  26, g:   2, b:  60 },
  { t: 0.12, r:  76, g:  29, b: 149 },
  { t: 0.25, r: 124, g:  58, b: 237 },
  { t: 0.38, r:  59, g: 130, b: 246 },
  { t: 0.50, r:  34, g: 211, b: 238 },
  { t: 0.62, r: 163, g: 230, b:  53 },
  { t: 0.72, r: 250, g: 204, b:  21 },
  { t: 0.83, r: 249, g: 115, b:  22 },
  { t: 1.0,  r: 239, g:  68, b:  68 },
];
function kdeRampColor(t) {
  let lo = KDE_RAMP[0], hi = KDE_RAMP[KDE_RAMP.length - 1];
  for (let i = 0; i < KDE_RAMP.length - 1; i++) {
    if (t >= KDE_RAMP[i].t && t <= KDE_RAMP[i + 1].t) { lo = KDE_RAMP[i]; hi = KDE_RAMP[i + 1]; break; }
  }
  const f = lo.t === hi.t ? 0 : (t - lo.t) / (hi.t - lo.t);
  const r = Math.round(lo.r + (hi.r - lo.r) * f);
  const g = Math.round(lo.g + (hi.g - lo.g) * f);
  const b = Math.round(lo.b + (hi.b - lo.b) * f);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}
function buildKDEHeatmap(strikes, isEU) {
  if (!strikes.length) return [];
  const cellDeg = isEU ? 0.25 : 0.08;
  // Build raw bins
  const bins = {};
  strikes.forEach(s => {
    const lk = +(Math.round(s.lat / cellDeg) * cellDeg).toFixed(4);
    const nk = +(Math.round(s.lon / cellDeg) * cellDeg).toFixed(4);
    const key = `${lk}_${nk}`;
    if (!bins[key]) bins[key] = { lat: lk, lon: nk, w: 0 };
    bins[key].w += 1;
  });
  // Gaussian smoothing (kernel radius = 2 cells)
  const cells = Object.values(bins);
  const smoothed = {};
  const KR = 2;
  cells.forEach(c => {
    for (let di = -KR; di <= KR; di++) {
      for (let dj = -KR; dj <= KR; dj++) {
        const dist2 = di * di + dj * dj;
        if (dist2 > KR * KR) continue;
        const sigma = KR / 2;
        const gaussian = Math.exp(-dist2 / (2 * sigma * sigma));
        const nLat = +(c.lat + di * cellDeg).toFixed(4);
        const nLon = +(c.lon + dj * cellDeg).toFixed(4);
        const k = `${nLat}_${nLon}`;
        if (!smoothed[k]) smoothed[k] = { lat: nLat, lon: nLon, v: 0 };
        smoothed[k].v += c.w * gaussian;
      }
    }
  });
  const vals = Object.values(smoothed);
  const maxV = Math.max(...vals.map(c => c.v));
  if (maxV <= 0) return [];
  const half = cellDeg * 0.55;
  const latStretch = isEU ? 0.72 : 0.70;
  return vals
    .map(cell => {
      const t = Math.pow(cell.v / maxV, 0.45);
      if (t < 0.04) return null;
      return {
        bounds: [[cell.lat - half, cell.lon - half / latStretch], [cell.lat + half, cell.lon + half / latStretch]],
        color: kdeRampColor(t),
        alpha: 0.15 + t * 0.65,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.alpha - b.alpha); // paint low-density first
}

function hexToRgb(hex) {
  if (!hex || hex[0] !== '#') return '148,163,184';
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)].join(',');
}

const STORM_RISK = {
  yellow: { color: '#facc15', fullLabel: 'Yellow Thunderstorm Advisory' },
  amber:  { color: '#f97316', fullLabel: 'Amber Thunderstorm Warning' },
  red:    { color: '#ef4444', fullLabel: 'Red Severe Thunderstorm Warning' },
};

/* ─────────────────────────────────────────────────────────────────────────
   Snapshot map — renders the strikes + density + warnings for one day.
   `histView` chooses the centre/zoom AND the bbox that filters strikes.
   `showHeatmap` toggles the density rectangles independently of strikes.
   ───────────────────────────────────────────────────────────────────────── */
const ForcedSnapshotMap = React.memo(function ForcedSnapshotMap({
  snaps, histView = 'uk', showWarnings, warnings, showHeatmap = true, strikeColour = 'age',
}) {
  const mapRef       = useRef(null);
  const mapInst      = useRef(null);
  const strikeLayer  = useRef(null);
  const heatLayer    = useRef(null);
  const warningLayer = useRef(null);
  const boxLayerRef  = useRef(null);
  const renderedKey  = useRef(null);
  const [boxSelectMode, setBoxSelectMode] = useState(false);
  const [boxResult,     setBoxResult]     = useState(null);
  const boxHandlerRef = useRef(null);

  const snapKey = useMemo(() => snaps.map(s => s.capturedAt).join('_'), [snaps]);

  // All strikes from all snaps for this day, deduped, region-filtered.
  const allStrikes = useMemo(() => {
    const seen = new Set();
    const out  = [];
    for (const snap of snaps) {
      for (const s of (snap.strikes || [])) {
        if (!s || s.lat == null || s.lon == null) continue;
        if (!inRegion(s.lat, s.lon, histView)) continue;
        const key = `${Math.round(s.lat * 1000)}_${Math.round(s.lon * 1000)}_${s.time}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
      }
    }
    return out;
  }, [snapKey, histView]); // eslint-disable-line

  const isEUView = histView === 'europe';

  const sampledStrikes = useMemo(() => {
    // Leaflet canvas renderer handles 20k+ markers fine at typical zoom levels.
    // Uniform stride sampling keeps spatial distribution intact.
    const CAP = 20000;
    if (allStrikes.length <= CAP) return allStrikes;
    const step = Math.ceil(allStrikes.length / CAP);
    return allStrikes.filter((_, i) => i % step === 0);
  }, [allStrikes]);

  const capturedAt = useMemo(() => Math.max(...snaps.map(s => s.capturedAt || 0)), [snaps]);

  // Initialise the map (once per histView change so it re-centres).
  useEffect(() => {
    const L = window.L;
    if (!L || !mapRef.current) return;
    // Tear down any existing instance so a region switch re-centres.
    if (mapInst.current) {
      try { mapInst.current.remove(); } catch (_) {}
      mapInst.current = null; strikeLayer.current = null; heatLayer.current = null; warningLayer.current = null;
      renderedKey.current = null;
    }
    const v = histView === 'europe' ? { center: [52, 9], zoom: 4 } : { center: [54, -2], zoom: 5 };
    const renderer = L.canvas({ padding: 0.5, tolerance: 2 });
    const map = L.map(mapRef.current, {
      center: v.center, zoom: v.zoom, zoomControl: true, attributionControl: false,
      preferCanvas: true, renderer, fadeAnimation: false, markerZoomAnimation: false, zoomSnap: 0.5,
    });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 10, subdomains: 'abcd', updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 2,
    }).addTo(map);
    heatLayer.current    = L.layerGroup().addTo(map);
    strikeLayer.current  = L.layerGroup().addTo(map);
    warningLayer.current = L.layerGroup().addTo(map);
    boxLayerRef.current  = L.layerGroup().addTo(map);
    mapInst.current = map;
    return () => {
      try { map.remove(); } catch (_) {}
      mapInst.current = null; strikeLayer.current = null; heatLayer.current = null; warningLayer.current = null; boxLayerRef.current = null; renderedKey.current = null;
    };
  }, [histView]);

  // Paint strikes (always) — circles, age-coloured or solid colour.
  useEffect(() => {
    const L = window.L;
    if (!L || !strikeLayer.current || !mapInst.current) return;
    // No cacheKey guard — colour changes must repaint immediately without page refresh.
    strikeLayer.current.clearLayers();
    sampledStrikes.forEach(s => {
      let color;
      if (strikeColour !== 'age') {
        color = STRIKE_COLOUR_OPTIONS.find(o => o.id === strikeColour)?.hex || '#facc15';
      } else {
        const ageMin = (capturedAt - s.time) / 60000;
        color = '#4c1d95';
        if      (ageMin < 5)   color = '#ffffff';
        else if (ageMin < 10)  color = '#facc15';
        else if (ageMin < 30)  color = '#f97316';
        else if (ageMin < 60)  color = '#ef4444';
        else if (ageMin < 360) color = '#7f1d1d';
        else if (ageMin < 720) color = '#7c3aed';
      }
      L.circleMarker([s.lat, s.lon], {
        radius: 2, color: 'transparent', fillColor: color, fillOpacity: 1, weight: 0, interactive: true,
      }).addTo(strikeLayer.current);
    });
  }, [snapKey, sampledStrikes, capturedAt, histView, strikeColour]); // eslint-disable-line

  // Paint heatmap — Gaussian KDE, matching the live map in TCM.jsx.
  useEffect(() => {
    const L = window.L;
    if (!L || !heatLayer.current || !mapInst.current) return;
    heatLayer.current.clearLayers();
    if (!showHeatmap) return;
    const kdeCells = buildKDEHeatmap(allStrikes, isEUView);
    kdeCells.forEach(cell => {
      L.rectangle(cell.bounds, {
        color: 'transparent', weight: 0,
        fillColor: cell.color,
        fillOpacity: cell.alpha,
        interactive: false,
        smoothFactor: 0,
      }).addTo(heatLayer.current);
    });
  }, [showHeatmap, allStrikes, isEUView]);

  // Paint warnings.
  useEffect(() => {
    const L = window.L;
    if (!L || !warningLayer.current) return;
    warningLayer.current.clearLayers();
    if (!showWarnings || !warnings?.length) return;
    warnings.forEach(w => {
      if (!w.corePolygon?.length) return;
      // Region-filter warnings too — if the centroid isn't in view region, skip.
      if (w.centroid && !inRegion(w.centroid.lat, w.centroid.lon, histView)) return;
      const cfg = STORM_RISK[w.risk];
      if (!cfg) return;
      L.polygon(w.corePolygon, { color: cfg.color, fillColor: cfg.color, fillOpacity: 0.18, weight: 2, interactive: false }).addTo(warningLayer.current);
    });
  }, [showWarnings, warnings, histView]);

  // Box-select tool
  useEffect(() => {
    const L = window.L;
    if (!L || !mapInst.current) return;
    const map = mapInst.current;
    if (boxHandlerRef.current) { map.off('mousedown', boxHandlerRef.current); boxHandlerRef.current = null; }
    if (!boxSelectMode) {
      map.dragging.enable();
      if (boxLayerRef.current) boxLayerRef.current.clearLayers();
      setBoxResult(null);
      return;
    }
    map.dragging.disable();
    let startLL = null;
    let rect = null;
    const onMD = (e) => {
      startLL = e.latlng;
      if (rect) { try { boxLayerRef.current?.removeLayer(rect); } catch(_){} rect = null; }
      setBoxResult(null);
      const onMM = (ev) => {
        if (!startLL) return;
        const b = L.latLngBounds(startLL, ev.latlng);
        if (rect) { try { rect.setBounds(b); } catch(_){} }
        else {
          rect = L.rectangle(b, { color:'#38bdf8', weight:2, fillOpacity:0.08, dashArray:'5,4' });
          if (boxLayerRef.current) rect.addTo(boxLayerRef.current);
        }
      };
      const onMU = (ev) => {
        map.off('mousemove', onMM); map.off('mouseup', onMU);
        if (!startLL) return;
        const b = L.latLngBounds(startLL, ev.latlng);
        const allS = snaps.flatMap(sn => sn.strikes || []);
        const count = allS.filter(s => b.contains([s.lat, s.lon])).length;
        setBoxResult({ count });
        startLL = null;
        map.dragging.enable();
        setBoxSelectMode(false);
      };
      map.on('mousemove', onMM);
      map.on('mouseup', onMU);
    };
    boxHandlerRef.current = onMD;
    map.on('mousedown', onMD);
    return () => { if (boxHandlerRef.current) map.off('mousedown', boxHandlerRef.current); };
  }, [boxSelectMode, snaps]);

  return (
    <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:0 }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6, flexWrap:'wrap' }}>
        <button onClick={() => setBoxSelectMode(v => !v)}
          style={{
            display:'flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:7, fontSize:'0.65rem', fontWeight:700,
            background: boxSelectMode ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.05)',
            border:`1px solid ${boxSelectMode ? '#38bdf8' : 'rgba(255,255,255,0.12)'}`,
            color: boxSelectMode ? '#38bdf8' : '#94a3b8', cursor:'pointer',
          }}>
          &#x25FD; {boxSelectMode ? 'Click & drag to draw box...' : 'Count strikes in box'}
        </button>
        {boxResult && (
          <span style={{ fontSize:'0.7rem', fontWeight:700, color:'#38bdf8', padding:'3px 9px', borderRadius:6, background:'rgba(56,189,248,0.12)', border:'1px solid rgba(56,189,248,0.3)' }}>
            {boxResult.count.toLocaleString()} strikes in selection
          </span>
        )}
      </div>
      <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: 380, background: '#060d1a' }} />
    </div>
  );
});

import { base44 } from '@/api/base44Client';
import { loadTodayStrikes } from '@/components/tcm/strikeStorage';
import { AURORA, AuroraRail } from '@/components/tcm/auroraGlass';

export default function HistoricalLightningPanel({
  lightMode = false,
  archive = [],
  forcedSnapshots = [],
  isAdmin = false,
}) {
  const [histFullscreen, setHistFullscreen] = useState(false);
  // When toggling fullscreen, add/remove body class and invalidate map size
  useEffect(() => {
    if (histFullscreen) {
      document.body.classList.add('tcm-hist-fullscreen');
    } else {
      document.body.classList.remove('tcm-hist-fullscreen');
    }
    return () => document.body.classList.remove('tcm-hist-fullscreen');
  }, [histFullscreen]);
  const [showWarnings, setShowWarnings] = useState(false);
  const [showHeatmap,  setShowHeatmap]  = useState(true);
  const [strikeColour, setStrikeColour] = useState('age');
  const [forcedMapDate, setForcedMapDate] = useState(null);
  const [dbSnapshots, setDbSnapshots] = useState([]);
  const [histRegion, setHistRegion] = useState('uk'); // 'uk' | 'europe'
  const [yesterdayUKStrikes, setYesterdayUKStrikes] = useState([]);
  const [yesterdayLoading, setYesterdayLoading] = useState(false);

  // Admin snapshot UI state
  const [adminBusy, setAdminBusy]   = useState(false);
  const [adminMsg, setAdminMsg]     = useState('');
  const [adminMsgOk, setAdminMsgOk] = useState(false);

  const chartRef  = useRef(null);
  const chartInst = useRef(null);
  const [dbReloadKey, setDbReloadKey] = useState(0); // bumped to trigger a DB reload

  // ── Load DB-saved snapshots (forced/whole-day + the regular daily archive) ─
  // The daily archiver writes one LightningArchive row per day (date "YYYY-MM-DD",
  // region "global") and then prunes the raw strikes >2 days old. That daily
  // archive is the only persistent history for older days, so we must load it
  // here — otherwise days more than a day old show nothing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Pull the most recent archive rows of every kind in one query.
        const rows = await base44.entities.LightningArchive.list('-captured_at', 200).catch(() => []);
        if (cancelled || !Array.isArray(rows)) return;
        const snaps = rows
          .filter(r => (r.strikes || []).length > 0 || (r.strike_count || 0) > 0)
          .map(r => ({
            capturedAt: r.captured_at,
            strikes: r.strikes || [],
            stormWarnings: [],
            isForced: /_(FORCED|WHOLEDAY)/.test(r.date || ''),
            strikeCount: r.strike_count || (r.strikes || []).length,
            date: r.date,
          }));
        if (!cancelled) setDbSnapshots(snaps);
      } catch (e) { console.warn('[HistoricalLightningPanel] DB load failed:', e?.message); }
    })();
    return () => { cancelled = true; };
  }, [dbReloadKey]); // bumped after admin snapshot saves to force DB re-fetch

  // ── Load yesterday's UK strikes from the DB ──────────────────────────────
  // The brief is: "add all the lightning strikes from yesterday in the UK to
  // the Historical Lightning panel and map." We fetch them once on mount and
  // wrap them in a synthetic snapshot keyed to yesterday's UK date so the
  // existing day-grid + day-map machinery can show them.
  useEffect(() => {
    let cancelled = false;
    setYesterdayLoading(true);
    (async () => {
      try {
        const res = await base44.functions.invoke('historicalLightning', {
          region: 'uk', daysBack: 1,
        });
        if (cancelled) return;
        const strikes = res?.data?.strikes || [];
        setYesterdayUKStrikes(strikes);
      } catch (e) {
        console.warn('[HistoricalLightningPanel] yesterday UK load failed:', e?.message);
      } finally {
        if (!cancelled) setYesterdayLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Group local archive (set at midnight) by date ────────────────────────
  const archiveByDate = useMemo(() => {
    const out = {};
    archive.forEach(a => {
      const d = a.capturedAt ? new Date(a.capturedAt).toISOString().slice(0, 10) : null;
      if (!d) return;
      if (!out[d]) out[d] = [];
      out[d].push(a);
    });
    return out;
  }, [archive]);

  // ── Merge local forced + DB snaps, key by `date` first so duplicates merge
  // ── cleanly (local force-snapshot + later DB-loaded copy share the same id)
  const allForcedSnaps = useMemo(() => {
    // Sort so the highest strike-count entry for each date wins the dedup —
    // the daily "global" archive row holds the full set, while stray "europe"
    // rows hold a subset. Keeping the largest avoids losing strikes.
    const ranked = [...forcedSnapshots, ...dbSnapshots].sort(
      (a, b) => (b.strikeCount || (b.strikes || []).length) - (a.strikeCount || (a.strikes || []).length)
    );
    const seen = new Set();
    const out = [];
    for (const s of ranked) {
      const key = s.date || (s.capturedAt ? String(Math.floor(s.capturedAt / 60000)) : null);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out;
  }, [forcedSnapshots, dbSnapshots]);

  const forcedByDate = useMemo(() => {
    const out = {};
    allForcedSnaps.forEach(snap => {
      const d = snap.capturedAt ? new Date(snap.capturedAt).toISOString().slice(0, 10) : null;
      if (!d) return;
      if (!out[d]) out[d] = [];
      out[d].push(snap);
    });
    return out;
  }, [allForcedSnaps]);

  // ── Synthesize yesterday's UK strikes as a "snapshot" if we have any ────
  // (Region-aware: we only attach this in UK view because the strikes are UK-
  //  scoped. In Europe view it's hidden.)
  const yesterdaySnap = useMemo(() => {
    if (!yesterdayUKStrikes.length) return null;
    // capturedAt = end of yesterday UTC, so age colouring shows them as 12-24h old.
    const d = new Date(); d.setUTCHours(0, 0, 0, 0);
    const capturedAt = d.getTime(); // start of today UTC = end of yesterday UTC
    return {
      date: `${yesterdayDateStr()}_YESTERDAY_UK`,
      capturedAt,
      isForced: false,
      strikes: yesterdayUKStrikes,
      stormWarnings: [],
      strikeCount: yesterdayUKStrikes.length,
      _isYesterdayUKSynth: true,
    };
  }, [yesterdayUKStrikes]);

  // forcedByDate augmented with yesterday's UK snap (only when in UK view).
  const augmentedForcedByDate = useMemo(() => {
    if (histRegion !== 'uk' || !yesterdaySnap) return forcedByDate;
    const out = { ...forcedByDate };
    const k = yesterdayDateStr();
    out[k] = [...(out[k] || []), yesterdaySnap];
    return out;
  }, [forcedByDate, yesterdaySnap, histRegion]);

  // ── Day list (last 14 days) ──────────────────────────────────────────────
  const allDays = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    allDays.push(d.toISOString().slice(0, 10));
  }
  const days = allDays.filter(d => {
    const archCount   = getRegionCountFromArchive(archiveByDate[d] || [], histRegion);
    const forcedCount = getRegionCountFromArchive(augmentedForcedByDate[d] || [], histRegion);
    return archCount > 0 || forcedCount > 0 || d === todayDateStr();
  });

  function getRegionCountFromArchive(items, region) {
    let total = 0;
    for (const a of items) {
      for (const s of (a.strikes || [])) {
        if (s && s.lat != null && s.lon != null && inRegion(s.lat, s.lon, region)) total++;
      }
    }
    return total;
  }

  const getDayCount = (d) => {
    const arch   = getRegionCountFromArchive(archiveByDate[d] || [], histRegion);
    const forced = getRegionCountFromArchive(augmentedForcedByDate[d] || [], histRegion);
    return Math.max(arch, forced);
  };
  const maxTotal = Math.max(1, ...days.map(getDayCount));

  const handleSelectDay = (dateStr) => {
    setShowWarnings(false);
    if (forcedMapDate === dateStr) { setForcedMapDate(null); return; }
    const hasAny = (augmentedForcedByDate[dateStr]?.length || 0) > 0
                || (archiveByDate[dateStr]?.length || 0) > 0;
    setForcedMapDate(hasAny ? dateStr : null);
  };

  // ── Chart of last 7 days ─────────────────────────────────────────────────
  useEffect(() => {
    const days7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days7.push(d.toISOString().slice(0, 10));
    }
    function renderChart() {
      if (!chartRef.current || !window.Chart) return;
      if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null; }
      const labels = days7.map(d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }));
      const data = days7.map(getDayCount);
      chartInst.current = new window.Chart(chartRef.current, {
        type: 'bar',
        data: { labels, datasets: [{
          label: `Blitzortung Strikes (${histRegion === 'uk' ? 'UK & Ireland' : 'Europe'})`,
          data,
          backgroundColor: data.map(v =>
            v >= 50000 ? 'rgba(239,68,68,0.8)' :
            v >= 10000 ? 'rgba(249,115,22,0.8)' :
            v >= 2000  ? 'rgba(250,204,21,0.8)' :
            v >= 300   ? 'rgba(52,211,153,0.8)' : 'rgba(167,139,250,0.6)'),
          borderColor: 'transparent', borderRadius: 5,
        }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y.toLocaleString()} strikes` } } },
          scales: {
            x: { ticks: { color: '#64748b', font: { size: 11 }, maxRotation: 30 }, grid: { color: 'rgba(255,255,255,0.04)' } },
            y: { ticks: { color: '#64748b', font: { size: 11 }, callback: v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v }, grid: { color: 'rgba(255,255,255,0.06)' }, beginAtZero: true },
          },
        },
      });
    }
    if (window.Chart) renderChart();
    else {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
      s.onload = renderChart;
      document.head.appendChild(s);
    }
    return () => { if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null; } };
  }, [archive, forcedSnapshots, histRegion, yesterdayUKStrikes]); // eslint-disable-line

  // ── Admin actions ────────────────────────────────────────────────────────
  const doForceSnapshot = async () => {
    setAdminBusy(true); setAdminMsg(''); setAdminMsgOk(false);
    try {
      // Read the live-strikes buffer straight from storage. This is the same
      // buffer LightningMap maintains — no need to thread state down through
      // the parent component. The backend will dedup against any existing
      // snapshot at the same archive key.
      const liveStrikes = loadTodayStrikes();
      const cutoff = Date.now();
      const res = await base44.functions.invoke('saveSnapshotToDB', {
        snapshotAt: cutoff,
        isWholeDay: false,
        region: 'global',
        strikes: liveStrikes.map(s => ({ lat: s.lat, lon: s.lon, time: s.time, amp: s.amp || 0 })),
      });
      const n = res?.data?.strikeCount ?? 0;
      setAdminMsg(`✓ Saved ${n.toLocaleString()} strikes — visible to all users`);
      setAdminMsgOk(true);
      // Force the DB-load effect to re-run so the new snapshot appears in the
      // panel immediately. (We bump the key so React notices the change.)
      setDbReloadKey(k => k + 1);
    } catch (e) {
      setAdminMsg(`✗ ${e?.message || 'Snapshot failed'}`);
      setAdminMsgOk(false);
    } finally {
      setAdminBusy(false);
      setTimeout(() => { setAdminMsg(''); }, 6000);
    }
  };

  const doWholeDayDBSnapshot = async () => {
    setAdminBusy(true); setAdminMsg(''); setAdminMsgOk(false);
    try {
      const res = await base44.functions.invoke('saveSnapshotToDB', {
        snapshotAt: Date.now(),
        isWholeDay: true,
        region: 'global',
      });
      const n = res?.data?.strikeCount ?? 0;
      setAdminMsg(`✓ Saved ${n.toLocaleString()} strikes for the whole day to DB`);
      setAdminMsgOk(true);
      setDbReloadKey(k => k + 1);
    } catch (e) {
      setAdminMsg(`✗ ${e?.message || 'Whole-day snapshot failed'}`);
      setAdminMsgOk(false);
    } finally {
      setAdminBusy(false);
      setTimeout(() => { setAdminMsg(''); }, 6000);
    }
  };

  // ── Theme (Aurora Glass) ──────────────────────────────────────────────────
  const bg = lightMode
    ? 'rgba(255,255,255,0.72)'
    : 'linear-gradient(160deg, rgba(30,41,72,0.55) 0%, rgba(16,23,46,0.5) 55%, rgba(10,15,32,0.62) 100%)';
  const border = lightMode ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)';
  const textMain = lightMode ? '#1e293b' : AURORA.text;
  const textSub  = lightMode ? '#64748b' : AURORA.textSub;

  return (
    <motion.div initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} className="mx-auto max-w-6xl px-6 mb-10">
      <div style={{ position:'relative', borderRadius:20, overflow:'hidden', border:`1px solid ${border}`, background:bg, backdropFilter:'blur(20px) saturate(150%)', WebkitBackdropFilter:'blur(20px) saturate(150%)', boxShadow:lightMode?'0 4px 24px rgba(0,0,0,0.08)':'0 12px 50px rgba(0,0,0,0.5)' }}>
        <AuroraRail light={lightMode} />
        <div style={{ padding:'18px 22px', borderBottom:`1px solid ${border}`, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div style={{ width:38, height:38, borderRadius:11, background:'linear-gradient(135deg, rgba(34,211,238,0.18), rgba(139,92,246,0.16))', border:'1px solid rgba(34,211,238,0.35)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:lightMode?'none':'0 0 16px rgba(34,211,238,0.16)' }}>
            <Zap style={{ width:18, height:18, color:lightMode?'#facc15':AURORA.cyan }} />
          </div>
          <div style={{ flex:1, minWidth:180 }}>
            <h3 style={{ margin:0, fontSize:'1rem', fontWeight:700, color:textMain }}>Historical Lightning Activity</h3>
            <p style={{ margin:0, fontSize:'0.72rem', color:textSub }}>
              {histRegion === 'uk' ? 'UK & Ireland' : 'Europe'} · Daily 23:59 snapshots + forced snapshots · Click a day to view map
            </p>
          </div>

          {/* Region toggle */}
          <div style={{ display:'flex', borderRadius:10, overflow:'hidden', border:`1px solid ${border}` }}>
            {[
              { id:'uk',     label:'🇬🇧 UK & Ireland' },
              { id:'europe', label:'🌍 Europe' },
            ].map(({ id, label }) => (
              <button key={id}
                onClick={() => { setHistRegion(id); setForcedMapDate(null); }}
                style={{
                  padding:'6px 12px', fontSize:'0.72rem', fontWeight:700,
                  background: histRegion === id ? 'linear-gradient(135deg,#a78bfa,#38bdf8)' : 'transparent',
                  color: histRegion === id ? '#0a0f1e' : textSub,
                  border:'none', cursor:'pointer', transition:'all 0.2s',
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Admin snapshot controls — only visible to admins */}
        {isAdmin && (
          <div style={{ padding:'14px 22px', borderBottom:`1px solid ${border}`, background: lightMode ? 'rgba(245,158,11,0.05)' : 'rgba(245,158,11,0.06)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <Camera style={{ width:14, height:14, color:'#f59e0b', flexShrink:0 }} />
              <span style={{ fontSize:'0.74rem', fontWeight:700, color:'#f59e0b', marginRight:8 }}>Admin Snapshot</span>

              <button onClick={doForceSnapshot} disabled={adminBusy}
                title="Save the current live strikes as a snapshot, visible to all users"
                style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:9, background: adminBusy ? 'rgba(245,158,11,0.05)' : 'rgba(245,158,11,0.15)', border:'1px solid rgba(245,158,11,0.35)', color:'#f59e0b', fontSize:'0.72rem', fontWeight:700, cursor: adminBusy ? 'wait' : 'pointer' }}>
                {adminBusy ? <Loader2 style={{ width:12, height:12, animation:'spin 1s linear infinite' }} /> : <Camera style={{ width:12, height:12 }} />}
                Force Snapshot Now
              </button>

              <button onClick={doWholeDayDBSnapshot} disabled={adminBusy}
                title="Save today's full DB strike record as a snapshot, visible to all users"
                style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:9, background: adminBusy ? 'rgba(56,189,248,0.05)' : 'rgba(56,189,248,0.15)', border:'1px solid rgba(56,189,248,0.35)', color:'#38bdf8', fontSize:'0.72rem', fontWeight:700, cursor: adminBusy ? 'wait' : 'pointer' }}>
                {adminBusy ? <Loader2 style={{ width:12, height:12, animation:'spin 1s linear infinite' }} /> : <Database style={{ width:12, height:12 }} />}
                Snapshot Today's Full Day → DB
              </button>

              {adminMsg && (
                <span style={{ fontSize:'0.72rem', fontWeight:700, color: adminMsgOk ? '#22c55e' : '#ef4444' }}>
                  {adminMsg}
                </span>
              )}
            </div>
          </div>
        )}

        <div style={{ padding:'20px 22px' }}>
          {/* Summary stats strip */}
          {(() => {
            const totalAll = days.reduce((s, d) => s + getDayCount(d), 0);
            const maxDay = days.reduce((best, d) => getDayCount(d) > getDayCount(best) ? d : best, days[0] || '');
            const maxCount = maxDay ? getDayCount(maxDay) : 0;
            const activeDays = days.filter(d => getDayCount(d) >= 300).length;
            return totalAll > 0 ? (
              <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap' }}>
                {[
                  { label:'14-day total', value: totalAll >= 10000 ? `${(totalAll/1000).toFixed(0)}k` : totalAll.toLocaleString(), color:'#a78bfa' },
                  { label:'Peak day', value: maxCount >= 1000 ? `${(maxCount/1000).toFixed(1)}k` : maxCount.toLocaleString(), color:'#facc15', sub: maxDay ? new Date(maxDay+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}) : '' },
                  { label:'Active days', value: `${activeDays} / ${days.length}`, color:'#34d399' },
                  { label:'Region', value: histRegion === 'uk' ? 'UK & Ireland' : 'Europe', color:'#38bdf8' },
                ].map(stat => (
                  <div key={stat.label} style={{ flex:'1 1 100px', minWidth:90, padding:'8px 12px', borderRadius:10, background:lightMode?'rgba(0,0,0,0.04)':'rgba(255,255,255,0.03)', border:`1px solid ${border}`, display:'flex', flexDirection:'column', gap:2 }}>
                    <span style={{ fontSize:'0.56rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:textSub }}>{stat.label}</span>
                    <span style={{ fontSize:'0.9rem', fontWeight:800, color:stat.color, fontFamily:'monospace' }}>{stat.value}</span>
                    {stat.sub && <span style={{ fontSize:'0.56rem', color:textSub }}>{stat.sub}</span>}
                  </div>
                ))}
              </div>
            ) : null;
          })()}
          {/* Chart — taller for better readability */}
          <div style={{ position:'relative', width:'100%', height:180, marginBottom:20 }}>
            <canvas ref={chartRef} role="img" aria-label="Day by day lightning strike counts" />
          </div>

          {/* Yesterday-loading hint (only relevant in UK view) */}
          {histRegion === 'uk' && yesterdayLoading && (
            <div style={{ padding:'8px 12px', marginBottom:12, borderRadius:8, background:'rgba(56,189,248,0.05)', border:'1px solid rgba(56,189,248,0.15)', display:'flex', alignItems:'center', gap:8 }}>
              <Loader2 style={{ width:12, height:12, color:'#38bdf8', animation:'spin 1s linear infinite' }} />
              <span style={{ fontSize:'0.72rem', color:'#38bdf8' }}>Loading yesterday's UK strikes…</span>
            </div>
          )}

          {days.length === 0 ? (
            <div style={{ padding:32, textAlign:'center' }}>
              <p style={{ fontSize:'0.85rem', color:textSub, margin:0 }}>
                No archived lightning data for {histRegion === 'uk' ? 'UK & Ireland' : 'Europe'} yet — strikes appear here after the first daily or forced snapshot.
              </p>
            </div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:`repeat(${Math.min(days.length,7)},1fr)`, gap:8 }}>
              {days.map((dateStr) => {
                const count = getDayCount(dateStr);
                const forcedSnaps = augmentedForcedByDate[dateStr] || [];
                const hasForced = forcedSnaps.some(s => s.isForced);
                const hasYesterdayUK = forcedSnaps.some(s => s._isYesterdayUKSynth);
                const barH = count > 0 ? Math.max(6, (count / maxTotal) * 100) : 4;
                const d = new Date(dateStr + 'T12:00:00');
                const dayName = d.toLocaleDateString('en-GB', { weekday:'short' });
                const dayNum  = d.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
                const isToday = dateStr === todayDateStr();
                let barColor = '#a78bfa';
                const selected = forcedMapDate === dateStr;
                if (count >= 50000) barColor = '#ef4444';
                else if (count >= 10000) barColor = '#f97316';
                else if (count >= 2000)  barColor = '#facc15';
                else if (count >= 300)   barColor = '#34d399';
                return (
                  <button key={dateStr} onClick={() => handleSelectDay(dateStr)}
                    title={count > 0 ? count.toLocaleString() + ' strikes · Click to view map' : 'No data for this day'}
                    style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, padding:'10px 5px 8px', borderRadius:14, background:selected?`rgba(250,204,21,0.12)`:lightMode?'rgba(0,0,0,0.04)':'rgba(255,255,255,0.03)', border:`1.5px solid ${selected?'rgba(250,204,21,0.65)':border}`, cursor:'pointer', transition:'all 0.2s ease', boxShadow:selected?`0 0 20px rgba(250,204,21,0.18)`:undefined }}>
                    <span style={{ fontSize:'0.62rem', fontWeight:800, color:isToday?'#facc15':textSub, letterSpacing:'0.06em', textTransform:'uppercase' }}>{dayName}</span>
                    <div style={{ width:'100%', height:90, display:'flex', alignItems:'flex-end', justifyContent:'center', position:'relative' }}>
                      <div style={{ position:'absolute', bottom:'25%', left:0, right:0, height:1, background:'rgba(255,255,255,0.04)' }} />
                      <div style={{ position:'absolute', bottom:'50%', left:0, right:0, height:1, background:'rgba(255,255,255,0.04)' }} />
                      <div style={{ position:'absolute', bottom:'75%', left:0, right:0, height:1, background:'rgba(255,255,255,0.04)' }} />
                      <div style={{ width:'68%', height:`${barH}%`, minHeight:count>0?5:3, borderRadius:'5px 5px 0 0', background:count>0?`linear-gradient(180deg, ${barColor}ff, ${barColor}88)`:'rgba(255,255,255,0.06)', opacity:count===0?0.4:1, transition:'height 0.55s cubic-bezier(0.34,1.4,0.64,1)', boxShadow:count>0?`0 0 14px ${barColor}55, 0 -3px 8px ${barColor}22`:undefined }} />
                    </div>
                    <span style={{ fontSize:'0.57rem', color:textSub, fontWeight:600 }}>{dayNum}</span>
                    <span style={{ fontSize:'0.72rem', fontWeight:800, color:count>0?barColor:textSub, fontFamily:'monospace', letterSpacing:'-0.02em' }}>
                      {count > 0 ? (count >= 10000 ? `${(count/1000).toFixed(0)}k` : count >= 1000 ? `${(count/1000).toFixed(1)}k` : count) : '—'}
                    </span>
                    {count > 0 && (
                      <span style={{ fontSize:'0.50rem', fontWeight:800, letterSpacing:'0.05em', padding:'1px 5px', borderRadius:4,
                        color: count>=50000?'#ef4444':count>=10000?'#f97316':count>=2000?'#facc15':count>=300?'#34d399':'#a78bfa',
                        background: count>=50000?'rgba(239,68,68,0.12)':count>=10000?'rgba(249,115,22,0.12)':count>=2000?'rgba(250,204,21,0.10)':count>=300?'rgba(52,211,153,0.10)':'rgba(167,139,250,0.10)' }}>
                        {count>=50000?'EXTREME':count>=10000?'MAJOR':count>=2000?'ACTIVE':count>=300?'MINOR':'TRACE'}
                      </span>
                    )}
                    {hasForced && (
                      <span style={{ fontSize:'0.50rem', fontWeight:700, color:'#f59e0b', background:'rgba(245,158,11,0.12)', borderRadius:4, padding:'1px 5px' }}>
                        Snap {forcedSnaps.filter(s => s.isForced).length}
                      </span>
                    )}
                    {hasYesterdayUK && !hasForced && (
                      <span style={{ fontSize:'0.50rem', fontWeight:700, color:'#38bdf8', background:'rgba(56,189,248,0.12)', borderRadius:4, padding:'1px 5px' }}>
                        DB
                      </span>
                    )}
                    {selected && <div style={{ width:18, height:3, borderRadius:99, background:barColor }} />}
                  </button>
                );
              })}
            </div>
          )}

          <AnimatePresence>
            {forcedMapDate && (augmentedForcedByDate[forcedMapDate] || archiveByDate[forcedMapDate] || []).length > 0 && (() => {
              const snapsForDay = augmentedForcedByDate[forcedMapDate]?.length
                ? augmentedForcedByDate[forcedMapDate]
                : (archiveByDate[forcedMapDate] || []);
              const allWarnings = snapsForDay.flatMap(snap => snap.stormWarnings || []);
              // Region-filter the warnings to the chosen histRegion.
              const regionWarnings = allWarnings.filter(w =>
                w.centroid ? inRegion(w.centroid.lat, w.centroid.lon, histRegion) : true
              );
              const uniqueWarnings = regionWarnings.filter((w, i, arr) => arr.findIndex(x => x.id === w.id) === i);
              const totalStrikes = snapsForDay.reduce((s, sn) => {
                return s + (sn.strikes || []).filter(x => x && inRegion(x.lat, x.lon, histRegion)).length;
              }, 0);
              return (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.35 }} style={{ overflow: histFullscreen ? 'visible' : 'hidden' }}>
                  <div className={histFullscreen ? 'hist-fullscreen-container' : ''} style={{
                    position: histFullscreen ? 'fixed' : 'relative',
                    inset: histFullscreen ? 0 : undefined,
                    zIndex: histFullscreen ? 9996 : undefined,
                    marginTop: histFullscreen ? 0 : 14,
                    borderRadius: histFullscreen ? 0 : 16,
                    overflow: 'hidden',
                    border: `2px solid rgba(245,158,11,0.45)`,
                    background: 'linear-gradient(135deg, rgba(245,158,11,0.06), rgba(6,13,26,0.98))',
                    boxShadow: histFullscreen ? 'none' : '0 8px 32px rgba(0,0,0,0.5)',
                  }}>
                    <div style={{ padding: '12px 16px', background: 'rgba(245,158,11,0.10)', borderBottom: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap:'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap:'wrap' }}>
                        <Camera style={{ width: 15, height: 15, color: '#f59e0b' }} />
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f59e0b' }}>
                          {new Date(forcedMapDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                        </span>
                        <span style={{ fontSize: '0.66rem', fontWeight:700, color:'#94a3b8', padding:'2px 7px', borderRadius:5, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.08)' }}>
                          {histRegion === 'uk' ? 'UK & Ireland' : 'Europe'}
                        </span>
                        <span style={{ fontSize: '0.72rem', fontWeight:800, color: totalStrikes>=10000?'#ef4444':totalStrikes>=2000?'#f97316':totalStrikes>=300?'#facc15':'#34d399', fontFamily: 'monospace', background: 'rgba(255,255,255,0.05)', padding: '2px 10px', borderRadius: 6, border:'1px solid rgba(255,255,255,0.08)' }}>
                          {totalStrikes >= 1000 ? `${(totalStrikes/1000).toFixed(1)}k` : totalStrikes.toLocaleString()} strikes
                        </span>
                        <span style={{ fontSize:'0.62rem', fontWeight:700, padding:'2px 8px', borderRadius:5, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)', color:'#64748b' }}>
                          {snapsForDay.length} snapshot{snapsForDay.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap:'wrap' }}>
                        {/* Heat-map toggle */}
                        <button onClick={() => setShowHeatmap(v => !v)}
                          title={showHeatmap ? 'Hide density heat-map' : 'Show density heat-map'}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, background: showHeatmap ? 'rgba(250,204,21,0.18)' : 'rgba(255,255,255,0.05)', border: `1px solid ${showHeatmap ? '#facc15' : 'rgba(255,255,255,0.12)'}`, color: showHeatmap ? '#facc15' : '#94a3b8', fontSize: '0.71rem', fontWeight: 700, cursor: 'pointer' }}>
                          {showHeatmap ? <Eye style={{ width: 11, height: 11 }} /> : <EyeOff style={{ width: 11, height: 11 }} />}
                          {showHeatmap ? 'Heat-map on' : 'Heat-map off'}
                        </button>
                        {uniqueWarnings.length > 0 && (
                          <button onClick={() => setShowWarnings(v => !v)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, background: showWarnings ? 'rgba(249,115,22,0.18)' : 'rgba(255,255,255,0.05)', border: `1px solid ${showWarnings ? '#f97316' : 'rgba(255,255,255,0.12)'}`, color: showWarnings ? '#f97316' : '#94a3b8', fontSize: '0.71rem', fontWeight: 700, cursor: 'pointer' }}>
                            <AlertTriangle style={{ width: 11, height: 11 }} />
                            {showWarnings ? 'Hide' : 'Show'} Warnings ({uniqueWarnings.length})
                          </button>
                        )}
                        <button onClick={() => setHistFullscreen(v => !v)}
                          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, background: histFullscreen ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.05)', border: `1px solid ${histFullscreen ? '#38bdf8' : 'rgba(255,255,255,0.12)'}`, color: histFullscreen ? '#38bdf8' : '#94a3b8', fontSize: '0.71rem', fontWeight: 700, cursor: 'pointer' }}>
                          {histFullscreen ? '✕ Exit' : '⛶ Fullscreen'}
                        </button>
                      </div>
                      {/* Colour picker row */}
                      <div style={{ display:'flex', alignItems:'center', gap:5, flexWrap:'wrap', marginTop:6 }}>
                        <Palette style={{ width:11, height:11, color:'#a78bfa', flexShrink:0 }} />
                        <span style={{ fontSize:'0.58rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#475569' }}>Strike colour</span>
                        {STRIKE_COLOUR_OPTIONS.map(opt => {
                          const active = strikeColour === opt.id;
                          return (
                            <button key={opt.id} onClick={() => setStrikeColour(opt.id)}
                              style={{
                                padding:'2px 8px', borderRadius:6, fontSize:'0.62rem', fontWeight:700, cursor:'pointer',
                                background: active ? (opt.hex ? opt.hex + '33' : 'rgba(167,139,250,0.18)') : 'rgba(255,255,255,0.04)',
                                border:`1px solid ${active ? (opt.hex || '#a78bfa') : 'rgba(255,255,255,0.09)'}`,
                                color: active ? (opt.hex || '#a78bfa') : '#64748b',
                              }}>
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {showWarnings && uniqueWarnings.length > 0 && (
                      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(245,158,11,0.15)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {uniqueWarnings.map((w, i) => {
                          const cfg = STORM_RISK[w.risk] || { color: '#f97316', fullLabel: w.risk };
                          return (
                            <div key={w.id || i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, background: `rgba(${hexToRgb(cfg.color)},0.1)`, border: `1px solid rgba(${hexToRgb(cfg.color)},0.3)` }}>
                              <div style={{ width: 8, height: 8, borderRadius: 2, background: cfg.color }} />
                              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: cfg.color }}>{cfg.fullLabel || w.risk}</span>
                              <span style={{ fontSize: '0.65rem', color: '#64748b' }}>{w.locationLabel} · {w.count} strikes</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div style={{ height: histFullscreen ? 'calc(100vh - 140px)' : 420, flex: histFullscreen ? '1 1 auto' : undefined, position:'relative' }}>
                      <ForcedSnapshotMap
                        key={`${forcedMapDate}_${histRegion}_${histFullscreen ? 'fs' : 'normal'}`}
                        snaps={snapsForDay}
                        histView={histRegion}
                        showWarnings={showWarnings}
                        warnings={uniqueWarnings}
                        showHeatmap={showHeatmap}
                        strikeColour={strikeColour}
                      />
                      {histFullscreen && (
                        <button onClick={() => setHistFullscreen(false)}
                          style={{ position:'fixed', top:16, right:16, zIndex:9999, display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:10, background:'rgba(6,13,26,0.95)', border:'1.5px solid rgba(250,204,21,0.5)', color:'#facc15', fontSize:'0.8rem', fontWeight:800, cursor:'pointer', backdropFilter:'blur(16px)', boxShadow:'0 4px 20px rgba(0,0,0,0.5)' }}>
                          ✕ Exit Fullscreen
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })()}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}