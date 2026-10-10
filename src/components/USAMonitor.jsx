/**
 * USAMonitor.jsx
 * USA TCM tab: convective risk overlays from Open-Meteo + real NWS active alerts
 * (Severe Thunderstorm Warnings, Tornado Watches, Tornado Warnings)
 * with notifications, sound alerts, and TTS for tornado events.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Bell, Volume2, VolumeX, RefreshCw, Clock, MapPin } from 'lucide-react';

// ── USA GRID POINTS ────────────────────────────────────────────────────────────
const USA_GRID = [
  { lat: 41.8, lon: -87.6,  name: 'Midwest (Chicago)' },
  { lat: 35.5, lon: -97.5,  name: 'Great Plains (OKC)' },
  { lat: 33.4, lon: -86.8,  name: 'Deep South (Birmingham)' },
  { lat: 29.8, lon: -95.4,  name: 'Gulf Coast (Houston)' },
  { lat: 32.8, lon: -117.1, name: 'SW (San Diego)' },
  { lat: 33.4, lon: -112.1, name: 'Desert SW (Phoenix)' },
  { lat: 47.6, lon: -122.3, name: 'Pacific NW (Seattle)' },
  { lat: 39.7, lon: -104.9, name: 'Rocky Mountain (Denver)' },
  { lat: 25.8, lon: -80.2,  name: 'Florida (Miami)' },
  { lat: 42.4, lon: -71.1,  name: 'NE (Boston)' },
  { lat: 36.2, lon: -86.8,  name: 'Tennessee Valley' },
  { lat: 38.9, lon: -77.0,  name: 'Mid-Atlantic (DC)' },
];

// USA base multipliers for regional climate realism
const USA_BASE_SCORE = {
  'Midwest (Chicago)':         { thunderstorm: 0.75, hail: 0.70, tornado: 0.65, lightning: 0.80 },
  'Great Plains (OKC)':        { thunderstorm: 0.90, hail: 0.85, tornado: 0.90, lightning: 0.85 },
  'Deep South (Birmingham)':   { thunderstorm: 0.80, hail: 0.65, tornado: 0.75, lightning: 0.85 },
  'Gulf Coast (Houston)':      { thunderstorm: 0.82, hail: 0.60, tornado: 0.65, lightning: 0.88 },
  'SW (San Diego)':            { thunderstorm: 0.25, hail: 0.15, tornado: 0.10, lightning: 0.30 },
  'Desert SW (Phoenix)':       { thunderstorm: 0.55, hail: 0.40, tornado: 0.15, lightning: 0.65 },
  'Pacific NW (Seattle)':      { thunderstorm: 0.20, hail: 0.15, tornado: 0.05, lightning: 0.22 },
  'Rocky Mountain (Denver)':   { thunderstorm: 0.65, hail: 0.75, tornado: 0.40, lightning: 0.70 },
  'Florida (Miami)':           { thunderstorm: 0.85, hail: 0.45, tornado: 0.55, lightning: 0.95 },
  'NE (Boston)':               { thunderstorm: 0.40, hail: 0.30, tornado: 0.20, lightning: 0.45 },
  'Tennessee Valley':          { thunderstorm: 0.78, hail: 0.65, tornado: 0.72, lightning: 0.80 },
  'Mid-Atlantic (DC)':         { thunderstorm: 0.55, hail: 0.45, tornado: 0.35, lightning: 0.60 },
};

const RISK_ORDER = ['No Risk', 'Very Low', 'Low', 'Marginal', 'Moderate', 'High'];
const RISK_TYPES_USA = [
  { id: 'thunderstorm', label: 'Thunderstorm', color: '#facc15' },
  { id: 'hail',         label: 'Hail',         color: '#38bdf8' },
  { id: 'tornado',      label: 'Tornado',       color: '#f97316' },
  { id: 'lightning',    label: 'Lightning',     color: '#a78bfa' },
];

// ── CACHE HELPERS ──────────────────────────────────────────────────────────────
const USA_CACHE_KEY_PREFIX = 'tcm_usa_v2_';
function getUkSlotKey() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find(p => p.type === t).value;
  const ukHour = parseInt(get('hour'), 10);
  const slot = [18, 12, 6, 0].find(h => h <= ukHour) ?? 0;
  return `${get('year')}-${get('month')}-${get('day')}T${String(slot).padStart(2, '0')}`;
}
const USA_CACHE_KEY = USA_CACHE_KEY_PREFIX + getUkSlotKey();

// NWS alerts cache (short TTL - 5 min)
const NWS_CACHE_KEY = 'tcm_nws_alerts_v2';
const NWS_CACHE_TTL = 5 * 60 * 1000;
const NWS_SEEN_KEY = 'tcm_nws_seen_ids';

// ── FETCH USA OPEN-METEO DATA ──────────────────────────────────────────────────
async function fetchUSAData() {
  const lats = USA_GRID.map(p => p.lat).join(',');
  const lons = USA_GRID.map(p => p.lon).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
    `&hourly=cape,lifted_index,precipitation_probability,relative_humidity_2m,wind_gusts_10m` +
    `&daily=cape_max,precipitation_probability_max,wind_gusts_10m_max,wind_speed_10m_max,precipitation_sum` +
    `&timezone=America%2FChicago&forecast_days=4`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function aggregateDays(data) {
  const { hourly, daily } = data;
  if (!hourly || !daily) return null;
  return daily.time.map((date, d) => {
    const s = d * 24, e = Math.min(s + 24, hourly.time.length);
    const slice = k => hourly[k]?.slice(s, e).filter(v => v != null) ?? [];
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const max = arr => arr.length ? Math.max(...arr) : 0;
    const min = arr => arr.length ? Math.min(...arr) : 5;
    return {
      date,
      capeMax: daily.cape_max?.[d] ?? max(slice('cape')),
      capeAvg: avg(slice('cape')),
      liMin: min(slice('lifted_index')),
      rhAvg: avg(slice('relative_humidity_2m')),
      ppMax: daily.precipitation_probability_max?.[d] ?? max(slice('precipitation_probability')),
      gustMax: avg(slice('wind_gusts_10m')),
    };
  });
}

function scoreRisk(m, type, baseMult = 1.0) {
  let score = 0;
  const { capeMax = 0, capeAvg = 0, liMin = 5, rhAvg = 0, ppMax = 0, gustMax = 0 } = m;
  if (capeMax >= 2000) score += 45; else if (capeMax >= 1000) score += 35;
  else if (capeMax >= 500) score += 25; else if (capeMax >= 200) score += 15;
  else if (capeMax >= 50) score += 7; else if (capeAvg >= 20) score += 3;
  if (liMin <= -8) score += 25; else if (liMin <= -6) score += 20;
  else if (liMin <= -4) score += 14; else if (liMin <= -2) score += 8;
  else if (liMin <= 0) score += 3;
  if (rhAvg >= 85) score += 15; else if (rhAvg >= 75) score += 10;
  else if (rhAvg >= 65) score += 6; else if (rhAvg >= 55) score += 2;
  if (ppMax >= 80) score += 10; else if (ppMax >= 60) score += 7;
  else if (ppMax >= 40) score += 4; else if (ppMax >= 20) score += 1;
  if (gustMax >= 80) score += 5; else if (gustMax >= 60) score += 3;
  else if (gustMax >= 45) score += 1;
  if (type === 'hail') {
    if (capeMax < 500 || gustMax < 40) score = Math.max(0, score - 20);
    if (capeMax >= 1500 && gustMax >= 60) score += 10;
  } else if (type === 'tornado') {
    score = Math.max(0, score - 25); // USA higher tornado baseline
    if (capeMax >= 800 && liMin <= -5 && gustMax >= 60) score += 20;
  } else if (type === 'lightning') {
    if (capeMax >= 300 && rhAvg >= 60) score += 5;
  }
  score = score * (0.4 + baseMult * 0.6);
  score = Math.max(0, Math.min(100, score));
  if (score >= 75) return 'High';
  if (score >= 55) return 'Moderate';
  if (score >= 38) return 'Marginal';
  if (score >= 22) return 'Low';
  if (score >= 10) return 'Very Low';
  return 'No Risk';
}

// ── FETCH NWS ACTIVE ALERTS ────────────────────────────────────────────────────
const NWS_EVENT_TYPES = [
  'Severe Thunderstorm Warning',
  'Tornado Warning',
  'Tornado Watch',
];

async function fetchNWSAlerts() {
  // Check cache first
  try {
    const cached = JSON.parse(localStorage.getItem(NWS_CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.fetchedAt < NWS_CACHE_TTL) {
      return cached.alerts;
    }
  } catch (_) {}

  const url = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert&urgency=Immediate,Expected';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'TCM Weather Monitor (educational)', 'Accept': 'application/geo+json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`NWS HTTP ${res.status}`);
  const data = await res.json();

  const alerts = (data.features || [])
    .filter(f => NWS_EVENT_TYPES.includes(f.properties?.event))
    .map(f => {
      const p = f.properties;
      // Extract polygon from geometry or affected zones
      let polygon = null;
      if (f.geometry?.type === 'Polygon') {
        polygon = f.geometry.coordinates[0].map(([lon, lat]) => [lat, lon]);
      } else if (f.geometry?.type === 'MultiPolygon') {
        polygon = f.geometry.coordinates[0][0].map(([lon, lat]) => [lat, lon]);
      }
      return {
        id: p.id,
        event: p.event,
        headline: p.headline || p.event,
        description: (p.description || '').slice(0, 500),
        area: p.areaDesc || '',
        onset: p.onset,
        expires: p.expires,
        severity: p.severity,
        urgency: p.urgency,
        polygon,
      };
    });

  try {
    localStorage.setItem(NWS_CACHE_KEY, JSON.stringify({ alerts, fetchedAt: Date.now() }));
  } catch (_) {}
  return alerts;
}

// ── SOUND ENGINE ───────────────────────────────────────────────────────────────
function playAlertTone(type, audioCtx) {
  try {
    const ctx = audioCtx;
    const now = ctx.currentTime;
    if (type === 'tornado_warning') {
      // Urgent rising siren
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(400 + i * 60, now + i * 0.6);
        osc.frequency.linearRampToValueAtTime(900 + i * 60, now + i * 0.6 + 0.5);
        gain.gain.setValueAtTime(0.4, now + i * 0.6);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.6 + 0.58);
        osc.start(now + i * 0.6); osc.stop(now + i * 0.6 + 0.6);
      }
    } else if (type === 'tornado_watch') {
      // Two-tone watch alert
      for (let i = 0; i < 2; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = i === 0 ? 660 : 550;
        gain.gain.setValueAtTime(0.3, now + i * 0.4);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.4 + 0.35);
        osc.start(now + i * 0.4); osc.stop(now + i * 0.4 + 0.38);
      }
    } else {
      // Severe thunderstorm - single beep
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now); osc.stop(now + 0.32);
    }
  } catch (_) {}
}

// ── TEXT TO SPEECH ─────────────────────────────────────────────────────────────
function speakAlert(text) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.9;
    utt.pitch = 1.1;
    utt.volume = 1.0;
    window.speechSynthesis.speak(utt);
  } catch (_) {}
}

// ── ALERT COLOR CONFIG ─────────────────────────────────────────────────────────
const ALERT_CONFIG = {
  'Tornado Warning':             { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.4)', icon: '🌪️', tts: true,  sound: 'tornado_warning' },
  'Tornado Watch':               { color: '#f97316', bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.35)', icon: '⚠️', tts: true,  sound: 'tornado_watch' },
  'Severe Thunderstorm Warning': { color: '#facc15', bg: 'rgba(250,204,21,0.10)', border: 'rgba(250,204,21,0.35)', icon: '⛈️', tts: false, sound: 'severe_tstorm' },
};

function formatTime(isoStr) {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
  } catch (_) { return isoStr; }
}

// ── LEAFLET LOADER ─────────────────────────────────────────────────────────────
let _lfPromise = null;
function loadLeaflet() {
  if (_lfPromise) return _lfPromise;
  _lfPromise = new Promise(resolve => {
    if (window.L) { resolve(); return; }
    if (!document.getElementById('lf-css-usa')) {
      const l = document.createElement('link'); l.id = 'lf-css-usa'; l.rel = 'stylesheet';
      l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(l);
    }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = resolve; document.head.appendChild(s);
  });
  return _lfPromise;
}

// ── RISK COLORS ────────────────────────────────────────────────────────────────
const RISK_COLORS_ARR = ['#64748b', '#86efac', '#22c55e', '#facc15', '#f97316', '#ef4444'];

// ── NOTIFICATION PANEL ─────────────────────────────────────────────────────────
function NotificationPanel({ alerts, onDismiss, soundEnabled, setSoundEnabled }) {
  if (!alerts.length) return null;
  return (
    <div style={{ position: 'fixed', top: 80, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380 }}>
      <AnimatePresence>
        {alerts.slice(0, 5).map(alert => {
          const cfg = ALERT_CONFIG[alert.event] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.3)', icon: '⚠️' };
          return (
            <motion.div key={alert.id}
              initial={{ opacity: 0, x: 120 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 120 }}
              transition={{ duration: 0.35 }}
              style={{ borderRadius: 16, background: 'rgba(6,13,26,0.97)', border: `1px solid ${cfg.border}`, backdropFilter: 'blur(16px)', padding: '14px 16px', boxShadow: `0 0 30px ${cfg.color}22` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>
                  {cfg.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 2px', fontSize: '0.8rem', fontWeight: 700, color: cfg.color }}>{alert.event}</p>
                  <p style={{ margin: '0 0 4px', fontSize: '0.72rem', color: '#cbd5e1', lineHeight: 1.4 }}>{alert.area.slice(0, 80)}</p>
                  <div style={{ display: 'flex', gap: 12, fontSize: '0.62rem', color: '#475569' }}>
                    <span>From: {formatTime(alert.onset)}</span>
                    <span>Until: {formatTime(alert.expires)}</span>
                  </div>
                </div>
                <button onClick={() => onDismiss(alert.id)} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 6, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                  <X style={{ width: 12, height: 12, color: '#64748b' }} />
                </button>
              </div>
              {alert.description && (
                <p style={{ margin: '8px 0 0', fontSize: '0.68rem', color: '#94a3b8', lineHeight: 1.5, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 8 }}>
                  {alert.description.slice(0, 150)}…
                </p>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ── ALERT LIST PANEL ───────────────────────────────────────────────────────────
function AlertListPanel({ alerts, onAlertClick }) {
  if (!alerts.length) return (
    <div style={{ padding: '20px', borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center', margin: '0 16px' }}>
      <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569' }}>✅ No active NWS severe weather alerts at this time.</p>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '0 16px' }}>
      {alerts.map(alert => {
        const cfg = ALERT_CONFIG[alert.event] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.25)', icon: '⚠️' };
        return (
          <motion.button key={alert.id} onClick={() => onAlertClick(alert)}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            style={{ textAlign: 'left', padding: '14px 16px', borderRadius: 14, background: cfg.bg, border: `1px solid ${cfg.border}`, cursor: 'pointer', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: '1.1rem' }}>{cfg.icon}</span>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: cfg.color }}>{alert.event}</span>
              {alert.polygon && <span style={{ marginLeft: 'auto', fontSize: '0.62rem', color: '#475569', display: 'flex', alignItems: 'center', gap: 3 }}><MapPin style={{ width: 10, height: 10 }} /> Map</span>}
            </div>
            <p style={{ margin: '0 0 4px', fontSize: '0.74rem', color: '#cbd5e1', lineHeight: 1.4 }}>{alert.headline?.slice(0, 100)}</p>
            <p style={{ margin: '0 0 4px', fontSize: '0.68rem', color: '#64748b' }}>{alert.area?.slice(0, 80)}</p>
            <div style={{ display: 'flex', gap: 12, fontSize: '0.62rem', color: '#475569' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock style={{ width: 10, height: 10 }} /> Start: {formatTime(alert.onset)}</span>
              <span>Expires: {formatTime(alert.expires)}</span>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

// ── USA MAP ────────────────────────────────────────────────────────────────────
function USAMap({ regionRisks, typeColors, alerts, lightMode }) {
  const mapRef = useRef(null);
  const mapInst = useRef(null);
  const alertLayerRef = useRef(null);
  const riskLayerRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { loadLeaflet().then(() => setReady(true)); }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || mapInst.current) return;
    const L = window.L;
    const tileUrl = lightMode
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'
      : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    const map = L.map(mapRef.current, {
      center: [38, -96], zoom: 4, zoomControl: true, attributionControl: false,
      scrollWheelZoom: false,
    });
    L.tileLayer(tileUrl, { maxZoom: 14, subdomains: 'abcd' }).addTo(map);
    map.fitBounds([[24, -125], [50, -66]]);
    riskLayerRef.current = L.layerGroup().addTo(map);
    alertLayerRef.current = L.layerGroup().addTo(map);
    mapInst.current = map;
    return () => {
      try { if (mapInst.current) { mapInst.current.stop(); mapInst.current.remove(); } } catch (_) {}
      mapInst.current = null;
    };
  }, [ready]); // eslint-disable-line

  // Draw risk dots for each grid point
  useEffect(() => {
    if (!ready || !mapInst.current || !riskLayerRef.current) return;
    const L = window.L;
    riskLayerRef.current.clearLayers();
    USA_GRID.forEach(pt => {
      const risk = regionRisks[pt.name] || 'No Risk';
      const rIdx = RISK_ORDER.indexOf(risk);
      if (rIdx < 1) return;
      const color = typeColors[rIdx] || '#64748b';
      const radius = 20 + rIdx * 15;
      L.circleMarker([pt.lat, pt.lon], {
        radius: radius, color, fillColor: color, fillOpacity: 0.15 + rIdx * 0.06,
        weight: rIdx >= 3 ? 2 : 1, opacity: 0.8,
      }).addTo(riskLayerRef.current)
        .bindTooltip(`<b style="color:${color}">${risk}</b><br/>${pt.name}`, { sticky: true });
    });
  }, [ready, regionRisks, typeColors]);

  // Draw NWS alert polygons
  useEffect(() => {
    if (!ready || !mapInst.current || !alertLayerRef.current) return;
    const L = window.L;
    alertLayerRef.current.clearLayers();
    alerts.forEach(alert => {
      if (!alert.polygon || alert.polygon.length < 3) return;
      const cfg = ALERT_CONFIG[alert.event] || { color: '#94a3b8' };
      L.polygon(alert.polygon, {
        color: cfg.color, weight: 2.5, fillColor: cfg.color, fillOpacity: 0.25, dashArray: alert.event.includes('Watch') ? '8 6' : null,
      }).addTo(alertLayerRef.current)
        .bindTooltip(`<b style="color:${cfg.color}">${alert.event}</b><br/><small>${alert.area?.slice(0, 60)}</small>`, { sticky: true });
    });
  }, [ready, alerts]);

  return (
    <div ref={mapRef} style={{ width: '100%', height: 300, borderRadius: 14, overflow: 'hidden', background: lightMode ? '#e8edf5' : '#060d1e' }} />
  );
}

// ── MAIN USA MONITOR ───────────────────────────────────────────────────────────
export default function USAMonitor({ isAdmin = false, lightMode = false }) {
  const [forecasts, setForecasts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeDay, setActiveDay] = useState(0);
  const [activeType, setActiveType] = useState('thunderstorm');
  const [alerts, setAlerts] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('tcm_usa_sound') !== 'false');
  const [selectedAlert, setSelectedAlert] = useState(null);
  const audioCtxRef = useRef(null);
  const overridesRef = useRef(() => {
    try { return JSON.parse(localStorage.getItem('tcm_risk_overrides_usa') || '{}'); } catch { return {}; }
  });

  // Persist sound preference
  useEffect(() => { localStorage.setItem('tcm_usa_sound', String(soundEnabled)); }, [soundEnabled]);

  function getAudioCtx() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    return audioCtxRef.current;
  }

  // ── Load forecasts (cached) ────────────────────────────────────────────────
  const loadForecasts = useCallback(async (force = false) => {
    if (!force) {
      try {
        const cached = localStorage.getItem(USA_CACHE_KEY);
        if (cached) { setForecasts(JSON.parse(cached)); setLoading(false); return; }
      } catch (_) {}
    }
    setLoading(true); setError(null);
    try {
      const results = await fetchUSAData();
      const dataArr = Array.isArray(results) ? results : [results];
      const pointResults = dataArr.map((r, i) => ({
        name: USA_GRID[i]?.name, days: aggregateDays(r),
      })).filter(p => p.name && p.days?.length);
      if (!pointResults.length) throw new Error('No USA data from Open-Meteo');

      const nDays = pointResults[0].days.length;
      const built = {};
      RISK_TYPES_USA.forEach(({ id: type }) => {
        built[type] = Array.from({ length: nDays }, (_, di) => {
          const regions = {};
          let sumCape = 0, sumRH = 0, count = 0;
          pointResults.forEach(({ name, days }) => {
            const d = days[di];
            if (!d) return;
            const baseMult = USA_BASE_SCORE[name]?.[type] ?? 0.6;
            regions[name] = scoreRisk(d, type, baseMult);
            sumCape += d.capeMax; sumRH += d.rhAvg; count++;
          });
          const avgCape = count ? sumCape / count : 0;
          const avgRH = count ? sumRH / count : 60;
          const sample = pointResults[0].days[di];
          const overallRisk = scoreRisk({ capeMax: avgCape, capeAvg: avgCape * 0.6, liMin: sample.liMin, rhAvg: avgRH, ppMax: sample.ppMax, gustMax: sample.gustMax }, type, 0.75);
          const dateStr = pointResults[0].days[di].date;
          const dayLabel = di === 0 ? 'Today' : di === 1 ? 'Tomorrow' : `Day ${di + 1}`;
          const formattedDate = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
          return { date: dateStr, dayLabel, formattedDate, type, overallRisk, avgCape: Math.round(avgCape), avgRH: Math.round(avgRH), regions };
        });
      });

      try { localStorage.setItem(USA_CACHE_KEY, JSON.stringify(built)); } catch (_) {}
      setForecasts(built);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);

  // ── Load NWS alerts ────────────────────────────────────────────────────────
  const loadAlerts = useCallback(async () => {
    setAlertsLoading(true); setAlertsError(null);
    try {
      const newAlerts = await fetchNWSAlerts();
      setAlerts(newAlerts);

      // Check for new alerts and notify
      const seen = new Set(JSON.parse(localStorage.getItem(NWS_SEEN_KEY) || '[]'));
      const genuinelyNew = newAlerts.filter(a => !seen.has(a.id));

      if (genuinelyNew.length > 0) {
        // Add to notifications
        setNotifications(prev => {
          const ids = new Set(prev.map(n => n.id));
          return [...genuinelyNew.filter(a => !ids.has(a.id)), ...prev].slice(0, 10);
        });

        genuinelyNew.forEach(alert => {
          seen.add(alert.id);
          const cfg = ALERT_CONFIG[alert.event];
          if (!cfg) return;

          // Play sound
          if (soundEnabled) {
            try { playAlertTone(cfg.sound, getAudioCtx()); } catch (_) {}
          }

          // TTS for tornado events
          if (cfg.tts) {
            const area = alert.area?.split(';')[0]?.trim() || 'the affected area';
            const msg = alert.event === 'Tornado Warning'
              ? `Tornado Warning issued for ${area}. Take shelter immediately. This is not a drill.`
              : `Tornado Watch issued for ${area}. Conditions are favourable for tornado development. Be prepared to take shelter.`;
            setTimeout(() => speakAlert(msg), 800);
          }
        });

        // Save seen IDs (keep last 500)
        const seenArr = [...seen].slice(-500);
        try { localStorage.setItem(NWS_SEEN_KEY, JSON.stringify(seenArr)); } catch (_) {}
      }
    } catch (e) { setAlertsError(e.message); }
    setAlertsLoading(false);
  }, [soundEnabled]); // eslint-disable-line

  useEffect(() => { loadForecasts(false); }, []); // eslint-disable-line
  useEffect(() => {
    loadAlerts();
    const iv = setInterval(loadAlerts, NWS_CACHE_TTL);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line

  const dismissNotification = (id) => setNotifications(prev => prev.filter(n => n.id !== id));

  const typeObj = RISK_TYPES_USA.find(t => t.id === activeType) ?? RISK_TYPES_USA[0];
  const dayFc = forecasts?.[activeType]?.[activeDay] ?? null;
  const topColor = dayFc ? (RISK_COLORS_ARR[RISK_ORDER.indexOf(dayFc.overallRisk)] || '#64748b') : '#64748b';
  const typeColors = RISK_TYPES_USA.find(t => t.id === activeType) ? RISK_COLORS_ARR : RISK_COLORS_ARR;

  const tornadoWarnings = alerts.filter(a => a.event === 'Tornado Warning');
  const tornadoWatches = alerts.filter(a => a.event === 'Tornado Watch');
  const tstormWarnings = alerts.filter(a => a.event === 'Severe Thunderstorm Warning');

  const fg = lightMode ? '#0f172a' : '#f1f5f9';
  const fg3 = lightMode ? '#475569' : '#64748b';

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', minHeight: '100vh', padding: '16px' }}>

      {/* Notification toasts */}
      <NotificationPanel alerts={notifications} onDismiss={dismissNotification} soundEnabled={soundEnabled} setSoundEnabled={setSoundEnabled} />

      {/* Header controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: fg, letterSpacing: '0.06em', textTransform: 'uppercase' }}>🇺🇸 USA — TCM Monitor</h2>
          <p style={{ margin: 0, fontSize: '0.62rem', color: fg3 }}>Open-Meteo ensemble · NWS Real Alerts · Updates every 5 min</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setSoundEnabled(v => !v)}
            style={{ padding: '6px 10px', borderRadius: 9, background: soundEnabled ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${soundEnabled ? 'rgba(167,139,250,0.4)' : 'rgba(255,255,255,0.1)'}`, color: soundEnabled ? '#a78bfa' : '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.7rem' }}>
            {soundEnabled ? <Volume2 style={{ width: 13, height: 13 }} /> : <VolumeX style={{ width: 13, height: 13 }} />}
            {soundEnabled ? 'Sound On' : 'Sound Off'}
          </button>
          <button onClick={() => { loadForecasts(true); loadAlerts(); }} disabled={loading}
            style={{ padding: '6px 10px', borderRadius: 9, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.7rem' }}>
            <RefreshCw style={{ width: 12, height: 12 }} /> Refresh
          </button>
        </div>
      </div>

      {/* NWS Alert Summary Banner */}
      {(tornadoWarnings.length > 0 || tornadoWatches.length > 0 || tstormWarnings.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {tornadoWarnings.length > 0 && (
            <div style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '1rem' }}>🌪️</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#ef4444' }}>{tornadoWarnings.length} Tornado Warning{tornadoWarnings.length > 1 ? 's' : ''} ACTIVE</span>
            </div>
          )}
          {tornadoWatches.length > 0 && (
            <div style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.4)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '1rem' }}>⚠️</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f97316' }}>{tornadoWatches.length} Tornado Watch{tornadoWatches.length > 1 ? 'es' : ''} in Effect</span>
            </div>
          )}
          {tstormWarnings.length > 0 && (
            <div style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(250,204,21,0.10)', border: '1px solid rgba(250,204,21,0.35)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '1rem' }}>⛈️</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#facc15' }}>{tstormWarnings.length} Severe Thunderstorm Warning{tstormWarnings.length > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      )}

      {/* Risk type tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {RISK_TYPES_USA.map(t => {
          const isActive = t.id === activeType;
          const dayF = forecasts?.[t.id]?.[activeDay];
          const tRisk = dayF?.overallRisk;
          const tColor = tRisk ? (RISK_COLORS_ARR[RISK_ORDER.indexOf(tRisk)] || '#64748b') : '#64748b';
          return (
            <button key={t.id} onClick={() => setActiveType(t.id)}
              style={{ padding: '7px 14px', borderRadius: 10, fontSize: '0.73rem', fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${isActive ? tColor : 'rgba(255,255,255,0.08)'}`, background: isActive ? `${tColor}20` : 'rgba(255,255,255,0.03)', color: isActive ? tColor : fg3, transition: 'all 0.2s' }}>
              {t.label}
              {tRisk && tRisk !== 'No Risk' && <span style={{ marginLeft: 6, fontSize: '0.6rem', color: tColor }}>• {tRisk}</span>}
            </button>
          );
        })}
      </div>

      {/* Day tabs */}
      {forecasts && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {(forecasts[activeType] || []).map((fc, idx) => {
            const rColor = RISK_COLORS_ARR[RISK_ORDER.indexOf(fc.overallRisk)] || '#64748b';
            const isAct = idx === activeDay;
            return (
              <button key={fc.date} onClick={() => setActiveDay(idx)}
                style={{ padding: '8px 14px', borderRadius: 10, cursor: 'pointer', background: isAct ? `${rColor}18` : 'rgba(255,255,255,0.02)', border: `1.5px solid ${isAct ? rColor : 'rgba(255,255,255,0.07)'}`, textAlign: 'left', transition: 'all 0.2s' }}>
                <div style={{ fontSize: '0.62rem', color: isAct ? rColor : fg3, fontWeight: 600, textTransform: 'uppercase' }}>{fc.dayLabel}</div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: rColor, marginTop: 2 }}>{fc.overallRisk}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* States */}
      {loading && !forecasts && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: fg3 }}>Loading USA ensemble data…</div>
      )}
      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: '0.78rem', marginBottom: 12 }}>
          ⚠ {error} <button onClick={() => loadForecasts(true)} style={{ marginLeft: 8, color: '#a78bfa', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.72rem' }}>Retry</button>
        </div>
      )}
      {!forecasts && !loading && !error && (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <button onClick={() => loadForecasts(true)}
            style={{ padding: '10px 22px', borderRadius: 12, background: 'rgba(139,92,246,0.18)', border: '1px solid rgba(139,92,246,0.4)', color: '#a78bfa', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}>
            Load USA Forecast Data
          </button>
        </div>
      )}

      {/* Risk card + map */}
      {dayFc && (
        <div style={{ marginBottom: 20, borderRadius: 18, overflow: 'hidden', background: lightMode ? 'rgba(248,250,252,0.9)' : 'rgba(10,15,30,0.9)', border: `1px solid ${topColor}30` }}>
          <div style={{ height: 3, background: `linear-gradient(90deg, ${topColor}, ${topColor}66, transparent)` }} />
          <div style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ padding: '6px 14px', borderRadius: 18, background: `${topColor}18`, border: `1px solid ${topColor}40`, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: topColor, display: 'inline-block' }} />
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: topColor }}>{dayFc.overallRisk}</span>
              </div>
              <span style={{ fontSize: '0.75rem', color: fg3 }}>{typeObj.label} · {dayFc.formattedDate}</span>
              <span style={{ marginLeft: 'auto', fontSize: '0.62rem', color: fg3, fontFamily: 'monospace' }}>CAPE ~{dayFc.avgCape} · RH ~{dayFc.avgRH}%</span>
            </div>
            <USAMap regionRisks={dayFc.regions} typeColors={RISK_COLORS_ARR} alerts={alerts} lightMode={lightMode} />
            {/* Regional breakdown */}
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(dayFc.regions).filter(([, r]) => r !== 'No Risk').sort((a, b) => RISK_ORDER.indexOf(b[1]) - RISK_ORDER.indexOf(a[1])).map(([name, risk]) => {
                const c = RISK_COLORS_ARR[RISK_ORDER.indexOf(risk)] || '#64748b';
                return (
                  <span key={name} style={{ padding: '4px 10px', borderRadius: 8, background: `${c}12`, border: `1px solid ${c}30`, fontSize: '0.68rem', fontWeight: 600, color: c }}>
                    {name.split('(')[0].trim()}: {risk}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* NWS Active Alerts Section */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '0 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bell style={{ width: 14, height: 14, color: '#f97316' }} />
            <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: fg3 }}>
              NWS Active Alerts {alerts.length > 0 && `(${alerts.length})`}
            </span>
          </div>
          <button onClick={loadAlerts} disabled={alertsLoading}
            style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b', fontSize: '0.65rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw style={{ width: 10, height: 10 }} /> Refresh
          </button>
        </div>
        {alertsLoading && <div style={{ padding: '12px 16px', fontSize: '0.75rem', color: fg3 }}>Loading NWS alerts…</div>}
        {alertsError && <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: '0.74rem', margin: '0 16px' }}>⚠ {alertsError}</div>}
        {!alertsLoading && !alertsError && <AlertListPanel alerts={alerts} onAlertClick={setSelectedAlert} />}
      </div>

      {/* Alert detail modal */}
      <AnimatePresence>
        {selectedAlert && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelectedAlert(null)} style={{ position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }} />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}
              style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 9101, width: '92%', maxWidth: 520, maxHeight: '85vh', overflowY: 'auto', background: 'linear-gradient(160deg,#0d1829,#1a1040)', border: `1px solid ${(ALERT_CONFIG[selectedAlert.event] || {}).border || 'rgba(255,255,255,0.2)'}`, borderRadius: 22, padding: 24 }}>
              <button onClick={() => setSelectedAlert(null)} style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X style={{ width: 14, height: 14 }} />
              </button>
              {(() => {
                const cfg = ALERT_CONFIG[selectedAlert.event] || { color: '#94a3b8', icon: '⚠️' };
                return (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                      <span style={{ fontSize: '1.6rem' }}>{cfg.icon}</span>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: cfg.color }}>{selectedAlert.event}</h3>
                        <p style={{ margin: 0, fontSize: '0.7rem', color: '#64748b' }}>{selectedAlert.severity} · {selectedAlert.urgency}</p>
                      </div>
                    </div>
                    <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: '#e2e8f0', lineHeight: 1.6 }}>{selectedAlert.headline}</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                      <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <p style={{ margin: '0 0 4px', fontSize: '0.6rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Start</p>
                        <p style={{ margin: 0, fontSize: '0.78rem', color: '#e2e8f0', fontWeight: 700 }}>{formatTime(selectedAlert.onset)}</p>
                      </div>
                      <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <p style={{ margin: '0 0 4px', fontSize: '0.6rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Expires</p>
                        <p style={{ margin: 0, fontSize: '0.78rem', color: '#e2e8f0', fontWeight: 700 }}>{formatTime(selectedAlert.expires)}</p>
                      </div>
                    </div>
                    <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', marginBottom: 12 }}>
                      <p style={{ margin: '0 0 4px', fontSize: '0.6rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Affected Area</p>
                      <p style={{ margin: 0, fontSize: '0.78rem', color: '#e2e8f0' }}>{selectedAlert.area}</p>
                    </div>
                    {selectedAlert.description && (
                      <div style={{ padding: '12px 14px', borderRadius: 10, background: `${cfg.color}08`, border: `1px solid ${cfg.color}20` }}>
                        <p style={{ margin: '0 0 6px', fontSize: '0.6rem', color: cfg.color, fontWeight: 700, textTransform: 'uppercase' }}>Details</p>
                        <p style={{ margin: 0, fontSize: '0.76rem', color: '#cbd5e1', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{selectedAlert.description}</p>
                      </div>
                    )}
                  </>
                );
              })()}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}