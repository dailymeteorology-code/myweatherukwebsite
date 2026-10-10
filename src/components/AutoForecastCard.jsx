/**
 * AutoForecastCard.jsx — TCM UK/Europe/USA Enhanced v8
 *
 * CHANGES IN v8 (over v7):
 *  - ADMIN AVAILABILITY TOGGLE: Admin can mark outlooks as unavailable.
 *    When unavailable, card shows a clean "check back tomorrow" message
 *    instead of the forecast. State persists in localStorage.
 *  - CUSTOM OPEN-METEO CLIENT: OpenMeteoEnsembleClient class replaces the
 *    old ad-hoc fetch. Configurable models, variables, retry logic, per-point
 *    caching, typed responses, graceful degradation.
 *  - CUSTOM SCORING SYSTEM: ConvectiveScorer replaces scoreRisk(). Each
 *    hazard type has its own weight table, CIN suppression curve, shear
 *    amplifiers, moisture bonuses, synoptic bonus, and threshold-to-risk
 *    mapping. Fully documented and tunable.
 *
 * DATA SOURCES:
 *  - Tomorrow.io API (key: zGnl3mg7nwcWHnl58qZCgGgx7pLLsvna)
 *  - Open-Meteo multi-model ensemble (6 models, 4-day horizon)
 *  - Blitzortung WebSocket: live UK/Ireland lightning strikes
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ── SVG ICONS ─────────────────────────────────────────────────────────────────
const SVG = {
  thunderstorm: (color = "currentColor", size = 14) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"/>
      <polyline points="13 11 9 17 15 17 11 23"/>
    </svg>
  ),
  hail: (color = "currentColor", size = 14) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"/>
      <line x1="8" y1="16" x2="8.01" y2="16" strokeWidth="3"/>
      <line x1="8" y1="20" x2="8.01" y2="20" strokeWidth="3"/>
      <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="3"/>
      <line x1="12" y1="22" x2="12.01" y2="22" strokeWidth="3"/>
      <line x1="16" y1="16" x2="16.01" y2="16" strokeWidth="3"/>
      <line x1="16" y1="20" x2="16.01" y2="20" strokeWidth="3"/>
    </svg>
  ),
  tornado: (color = "currentColor", size = 14) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 4H3"/><path d="M18 8H6"/><path d="M19 12H9"/><path d="M16 16h-6"/><path d="M11 20h2"/>
    </svg>
  ),
  lightning: (color = "currentColor", size = 14) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  refresh: (color = "currentColor") => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  ),
  edit: (color = "currentColor") => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  ),
  x: (color = "currentColor") => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  play: (color = "currentColor") => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill={color} stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
  ),
  pause: (color = "currentColor") => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill={color} stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
  ),
  clock: (color = "currentColor") => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  ),
  bolt: (color = "currentColor", size = 10) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>
  ),
  zap: (color = "currentColor", size = 12) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
  ),
  check: (color = "currentColor") => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
  ),
  warning: (color = "currentColor", size = 20) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
};

function TypeIcon({ id, color, size = 14 }) {
  const fn = SVG[id];
  if (!fn) return null;
  return fn(color, size);
}

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const RISK_ORDER = ["No Risk", "Very Low", "Low", "Marginal", "Moderate", "High", "Severe"];

const RISK_TYPES = [
  {
    id: "thunderstorm", label: "Thunderstorm",
    colors: ["#64748b", "#16a34a", "#22c55e", "#facc15", "#f97316", "#ef4444", "#0a0a0a"],
    guide: [
      "Stable atmosphere. No convective triggers detected — no thunderstorm activity expected.",
      "Isolated, brief showers may spark an isolated lightning strike. Impacts will be negligible but worth monitoring.",
      "Scattered thundery showers expected. Activity will remain disorganised but lightning, small hail and gusty winds are possible.",
      "A few intense cells could produce localised severe weather — sudden flash flooding, hail up to 20mm and potentially damaging gusts.",
      "Organised storm systems likely. Frequent lightning, hail up to 40mm, destructive gusts 60-80mph and flash flooding are probable across affected areas.",
      "Dangerous and potentially life-threatening severe storm event. Widespread structural damage, giant hail, extreme flooding and major travel disruption are expected.",
      "CATASTROPHIC storm event. Extreme widespread destruction, life-threatening flooding, giant hail and extreme wind damage. Do not travel.",
    ],
  },
  {
    id: "hail", label: "Hail",
    colors: ["#64748b", "#7dd3fc", "#0ea5e9", "#6366f1", "#8b5cf6", "#6d28d9", "#0a0a0a"],
    guide: [
      "No hail risk. Insufficient instability or moisture for hail-producing convection.",
      "Trace hail (< 5mm) possible with isolated showers — essentially negligible impact.",
      "Small hail (5–15mm) with some thundery showers. Minor crop and vehicle damage possible.",
      "Hail up to 30mm likely with active cells. Significant crop damage, vehicle dents and roof damage probable.",
      "Large hail 30–50mm. Widespread property damage, injured livestock and broken glazing expected.",
      "Giant hail > 50mm — life-threatening. Structural roof failure, vehicle write-offs and serious injuries possible.",
      "Extreme hail > 70mm. Catastrophic property destruction and life-threatening impacts across affected areas.",
    ],
  },
  {
    id: "tornado", label: "Tornado",
    colors: ["#64748b", "#d97706", "#f59e0b", "#ea580c", "#dc2626", "#7c3aed", "#0a0a0a"],
    guide: [
      "No tornado risk. Atmosphere lacks the organisation required for rotational storms.",
      "Very weak, brief rotation possible — mainly waterspout risk near coasts. No significant damage expected.",
      "Weak tornadoes (EF0–EF1) possible with favourable low-level shear. Localised tree and structural damage.",
      "Organised rotation and EF1–EF2 tornadoes possible. Significant property damage and injuries likely in affected areas.",
      "Strong supercells developing. EF2–EF3 tornadoes are a real threat. Major structural damage and serious casualties possible.",
      "Violent tornadoes (EF3+) — extreme danger to life. Catastrophic destruction within the tornado path.",
      "Multiple violent long-track tornadoes (EF4+). Extreme danger — evacuate if in path. Complete destruction of well-built structures.",
    ],
  },
  {
    id: "lightning", label: "Lightning",
    colors: ["#64748b", "#fbbf24", "#f59e0b", "#ea580c", "#dc2626", "#7c3aed", "#0a0a0a"],
    guide: [
      "No lightning expected. Atmosphere is stable.",
      "Isolated lightning possible. Very low probability — remain aware if outdoors.",
      "Scattered lightning with thundery showers. Seek shelter if outdoors — cloud-to-ground strikes possible.",
      "Frequent lightning. Dangerous for outdoor activities — seek shelter immediately and stay indoors.",
      "Very frequent lightning with dangerous strike density. All outdoor activities should be cancelled.",
      "Extreme lightning density — remain indoors in a permanent structure. Direct strike risk is high.",
      "Catastrophic lightning density. Extreme ground flash density. Remain in substantial shelter. Immediate risk to life.",
    ],
  },
];

// ── AVAILABILITY STORAGE KEY ──────────────────────────────────────────────────
const AVAILABILITY_STORAGE_KEY = "tcm_outlook_available_v1";

function loadAvailability() {
  try {
    const raw = localStorage.getItem(AVAILABILITY_STORAGE_KEY);
    if (raw === null) return true; // default: available
    return JSON.parse(raw);
  } catch { return true; }
}

function saveAvailability(val) {
  try { localStorage.setItem(AVAILABILITY_STORAGE_KEY, JSON.stringify(val)); } catch {}
}

// ── UK/IRELAND REGIONS ─────────────────────────────────────────────────────────
const UK_REGIONS = {
  "Highlands":           { centroid: [57.5, -5.0],  polygon: [[58.0,-6.0],[58.5,-4.5],[57.8,-3.5],[57.0,-4.0],[56.8,-5.5]], baseScore: {} },
  "Grampian":            { centroid: [57.1, -2.7],  polygon: [[57.6,-3.5],[57.8,-2.0],[56.8,-2.0],[56.5,-2.8],[56.8,-3.8]], baseScore: {} },
  "Tayside":             { centroid: [56.6, -3.1],  polygon: [[57.0,-3.5],[57.0,-2.5],[56.2,-2.5],[56.0,-3.2],[56.3,-4.0]], baseScore: {} },
  "Central Scotland":    { centroid: [56.1, -3.9],  polygon: [[56.5,-4.5],[56.5,-3.0],[55.8,-3.0],[55.6,-4.2],[55.9,-5.0]], baseScore: {} },
  "Strathclyde":         { centroid: [55.8, -4.5],  polygon: [[56.2,-5.5],[56.5,-4.2],[55.8,-3.8],[55.4,-4.2],[55.3,-5.2]], baseScore: {} },
  "Lothian & Borders":   { centroid: [55.8, -2.8],  polygon: [[56.1,-3.5],[56.1,-2.0],[55.4,-2.0],[55.2,-3.0],[55.5,-3.8]], baseScore: {} },
  "Dumfries":            { centroid: [55.0, -3.6],  polygon: [[55.4,-4.2],[55.4,-2.8],[54.8,-2.8],[54.6,-3.8],[54.9,-4.8]], baseScore: {} },
  "Northern Ireland":    { centroid: [54.7, -6.5],  polygon: [[55.3,-8.0],[55.3,-5.5],[54.0,-5.5],[54.0,-8.0]], baseScore: {} },
  "Republic of Ireland": { centroid: [53.2, -8.0],  polygon: [[55.3,-10.0],[55.3,-5.8],[51.4,-6.0],[51.4,-10.5]], baseScore: {} },
  "Northumberland":      { centroid: [55.2, -2.0],  polygon: [[55.8,-2.5],[55.8,-1.5],[54.8,-1.5],[54.6,-2.3],[55.0,-3.0]], baseScore: {} },
  "Cumbria":             { centroid: [54.6, -2.8],  polygon: [[55.0,-3.5],[55.0,-2.2],[54.2,-2.0],[54.0,-3.0],[54.3,-3.8]], baseScore: {} },
  "Yorkshire":           { centroid: [53.8, -1.5],  polygon: [[54.5,-2.0],[54.5,-0.2],[53.0,-0.2],[53.0,-2.2],[53.8,-2.5]], baseScore: {} },
  "North West England":  { centroid: [53.5, -2.5],  polygon: [[54.0,-3.2],[54.0,-2.0],[53.0,-2.0],[53.0,-3.5],[53.5,-3.8]], baseScore: {} },
  "East Midlands":       { centroid: [52.8, -1.0],  polygon: [[53.5,-1.5],[53.5,0.2],[52.2,0.2],[52.0,-1.5],[52.5,-2.0]], baseScore: {} },
  "West Midlands":       { centroid: [52.5, -2.0],  polygon: [[53.0,-2.5],[53.0,-1.2],[52.0,-1.2],[51.8,-2.5],[52.2,-3.0]], baseScore: {} },
  "North Wales":         { centroid: [53.1, -3.8],  polygon: [[53.5,-5.0],[53.5,-2.8],[52.5,-2.8],[52.5,-5.0]], baseScore: {} },
  "South Wales":         { centroid: [51.8, -3.5],  polygon: [[52.4,-5.0],[52.4,-2.5],[51.2,-2.5],[51.2,-5.5]], baseScore: {} },
  "East Anglia":         { centroid: [52.3, 0.9],   polygon: [[53.0,-0.2],[53.0,1.8],[51.6,1.8],[51.6,-0.2]], baseScore: {} },
  "London & SE":         { centroid: [51.5, 0.1],   polygon: [[51.9,-0.5],[51.9,1.5],[51.0,1.5],[51.0,-0.5]], baseScore: {} },
  "South England":       { centroid: [51.0, -1.5],  polygon: [[51.5,-2.0],[51.5,0.8],[50.5,0.8],[50.5,-2.5]], baseScore: {} },
  "South West England":  { centroid: [50.7, -3.5],  polygon: [[51.5,-2.5],[51.5,-3.5],[51.0,-5.5],[50.0,-5.5],[50.0,-2.5]], baseScore: {} },
  "Cornwall":            { centroid: [50.3, -5.0],  polygon: [[50.7,-4.5],[50.6,-4.0],[50.0,-5.7],[49.9,-6.5],[50.1,-5.8]], baseScore: {} },
};

const UK_GRID = [
  { name: "Highlands",          lat: 57.5, lon: -5.0 },
  { name: "Highlands",          lat: 58.2, lon: -4.5 },
  { name: "Highlands",          lat: 57.0, lon: -5.5 },
  { name: "Grampian",           lat: 57.1, lon: -2.7 },
  { name: "Grampian",           lat: 57.5, lon: -2.2 },
  { name: "Tayside",            lat: 56.6, lon: -3.1 },
  { name: "Tayside",            lat: 56.5, lon: -2.6 },
  { name: "Central Scotland",   lat: 56.1, lon: -3.9 },
  { name: "Central Scotland",   lat: 56.0, lon: -3.3 },
  { name: "Strathclyde",        lat: 55.8, lon: -4.5 },
  { name: "Strathclyde",        lat: 55.4, lon: -5.0 },
  { name: "Lothian & Borders",  lat: 55.8, lon: -2.8 },
  { name: "Lothian & Borders",  lat: 55.5, lon: -2.5 },
  { name: "Dumfries",           lat: 55.0, lon: -3.6 },
  { name: "Dumfries",           lat: 54.8, lon: -3.2 },
  { name: "Northern Ireland",   lat: 54.7, lon: -6.5 },
  { name: "Northern Ireland",   lat: 55.0, lon: -6.0 },
  { name: "Northern Ireland",   lat: 54.3, lon: -6.0 },
  { name: "Republic of Ireland",lat: 53.2, lon: -8.0 },
  { name: "Republic of Ireland",lat: 54.0, lon: -7.5 },
  { name: "Republic of Ireland",lat: 52.2, lon: -8.5 },
  { name: "Republic of Ireland",lat: 53.3, lon: -6.2 },
  { name: "Republic of Ireland",lat: 51.9, lon: -8.5 },
  { name: "Republic of Ireland",lat: 53.8, lon: -9.0 },
  { name: "Republic of Ireland",lat: 52.7, lon: -7.2 },
  { name: "Northumberland",     lat: 55.2, lon: -2.0 },
  { name: "Northumberland",     lat: 54.9, lon: -1.8 },
  { name: "Cumbria",            lat: 54.6, lon: -2.8 },
  { name: "Cumbria",            lat: 54.3, lon: -3.0 },
  { name: "Yorkshire",          lat: 53.8, lon: -1.5 },
  { name: "Yorkshire",          lat: 54.2, lon: -0.8 },
  { name: "Yorkshire",          lat: 53.5, lon: -1.0 },
  { name: "Yorkshire",          lat: 54.0, lon: -1.7 },
  { name: "North West England", lat: 53.5, lon: -2.5 },
  { name: "North West England", lat: 53.8, lon: -3.0 },
  { name: "North West England", lat: 53.2, lon: -2.8 },
  { name: "East Midlands",      lat: 52.8, lon: -1.0 },
  { name: "East Midlands",      lat: 52.5, lon: -0.5 },
  { name: "East Midlands",      lat: 53.0, lon: -0.8 },
  { name: "East Midlands",      lat: 52.3, lon: -1.2 },
  { name: "West Midlands",      lat: 52.5, lon: -2.0 },
  { name: "West Midlands",      lat: 52.0, lon: -1.8 },
  { name: "West Midlands",      lat: 52.7, lon: -1.7 },
  { name: "North Wales",        lat: 53.1, lon: -3.8 },
  { name: "North Wales",        lat: 52.8, lon: -4.2 },
  { name: "South Wales",        lat: 51.8, lon: -3.5 },
  { name: "South Wales",        lat: 51.5, lon: -4.0 },
  { name: "South Wales",        lat: 52.2, lon: -3.2 },
  { name: "East Anglia",        lat: 52.3, lon: 0.9 },
  { name: "East Anglia",        lat: 51.9, lon: 1.2 },
  { name: "East Anglia",        lat: 52.7, lon: 0.4 },
  { name: "East Anglia",        lat: 52.0, lon: 0.5 },
  { name: "London & SE",        lat: 51.5, lon: 0.1 },
  { name: "London & SE",        lat: 51.3, lon: 0.5 },
  { name: "London & SE",        lat: 51.7, lon: -0.2 },
  { name: "London & SE",        lat: 51.1, lon: 1.0 },
  { name: "South England",      lat: 51.0, lon: -1.5 },
  { name: "South England",      lat: 51.2, lon: -0.3 },
  { name: "South England",      lat: 50.9, lon: -0.8 },
  { name: "South England",      lat: 51.4, lon: -0.7 },
  { name: "South West England", lat: 50.9, lon: -3.2 },
  { name: "South West England", lat: 51.1, lon: -2.5 },
  { name: "South West England", lat: 51.3, lon: -2.0 },
  { name: "South West England", lat: 51.0, lon: -4.0 },
  { name: "Cornwall",           lat: 50.3, lon: -5.0 },
  { name: "Cornwall",           lat: 50.5, lon: -4.5 },
  { name: "Cornwall",           lat: 50.1, lon: -5.5 },
];

const EUROPE_REGIONS = {};
const EUROPE_GRID    = [
  { name: "W Europe", lat: 50, lon: 10 },
  { name: "W Europe", lat: 48, lon: 8 },
  { name: "W Europe", lat: 52, lon: 14 },
];
const USA_REGIONS = {};
const USA_GRID    = [{ name: "Central USA", lat: 38, lon: -96 }];

// ── TOMORROW.IO CONFIG ─────────────────────────────────────────────────────────
const TOMORROW_API_KEY = "zGnl3mg7nwcWHnl58qZCgGgx7pLLsvna";
const TOMORROW_BASE    = "https://api.tomorrow.io/v4";
const TOMORROW_RATE_LIMIT_MS = 150;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ── SLOT HELPERS ───────────────────────────────────────────────────────────────
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

function msUntilNextSlot() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t) => parseInt(parts.find(p => p.type === t).value, 10);
  const h = get('hour'), m = get('minute'), s = get('second');
  const nextBoundary = [0, 6, 12, 18, 24].find(b => b > h) ?? 24;
  return (nextBoundary - h) * 3600000 - m * 60000 - s * 1000;
}

// ── DESCRIPTION STORAGE ───────────────────────────────────────────────────────
function descStorageKey(slotKey, type, dayOffset) {
  return `tcm_desc_v2_${slotKey}_${type}_${dayOffset}`;
}
function loadDesc(slotKey, type, dayOffset) {
  try { const raw = localStorage.getItem(descStorageKey(slotKey, type, dayOffset)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function saveDesc(slotKey, type, dayOffset, data) {
  try { localStorage.setItem(descStorageKey(slotKey, type, dayOffset), JSON.stringify(data)); } catch {}
}

// ── GEOMETRY ─────────────────────────────────────────────────────────────────
function chaikin(pts, passes = 3) {
  let p = pts;
  for (let n = 0; n < passes; n++) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = out;
  }
  return p;
}

function convexHull(pts) {
  if (pts.length < 3) return pts;
  const sorted = [...pts].sort((a, b) => a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]);
  const cross = (O, A, B) => (A[1] - O[1]) * (B[0] - O[0]) - (A[0] - O[0]) * (B[1] - O[1]);
  const lo = [], hi = [];
  for (const p of sorted) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = sorted.length - 1; i >= 0; i--) { const p = sorted[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  hi.pop(); lo.pop();
  return [...lo, ...hi];
}

function expandPoly(ring, dist, noise = 0) {
  const cLat = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cLon = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return ring.map(([lat, lon], i) => {
    const dLat = lat - cLat, dLon = lon - cLon;
    const len = Math.sqrt(dLat * dLat + dLon * dLon) || 1;
    const wobble = noise * (Math.sin(i * 2.3 + lat * 3.1) * 0.6 + Math.cos(i * 1.7 + lon * 2.7) * 0.4);
    return [lat + (dLat / len) * (dist + wobble), lon + (dLon / len) * (dist + wobble)];
  });
}

function centroidDist([la, lo], [lb, lb2]) {
  const dlat = la - lb, dlon = (lo - lb2) * Math.cos((la + lb) * Math.PI / 360);
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

function buildRiskBlobs(regionData, typeColors, regionDefs) {
  const defs = regionDefs || UK_REGIONS;
  const isEuropeSet = defs === EUROPE_REGIONS;
  const isUSASet = defs === USA_REGIONS;
  // Tightened gap & expansion so risk blobs stay over the regions they describe
  // rather than ballooning out into the North Sea / Atlantic.
  const GAP        = isEuropeSet ? 8.5 : isUSASet ? 5.5 : 1.6;
  const expandBase = isEuropeSet ? 0.5 : isUSASet ? 0.35 : 0.05;
  const expandStep = isEuropeSet ? 0.12 : isUSASet ? 0.10 : 0.015;
  const blobs = {};
  for (let rIdx = 1; rIdx <= 6; rIdx++) {
    const risk  = RISK_ORDER[rIdx];
    const color = typeColors[rIdx];
    const regionPoints = [];
    for (const [name, data] of Object.entries(regionData)) {
      if (RISK_ORDER.indexOf(data.risk) < rIdx) continue;
      const def = defs[name];
      if (!def) continue;
      const polyPts = def.polygon?.map(([la, lo]) => [la, lo]) ?? [];
      const seeds = polyPts.length >= 3 ? polyPts : [[def.centroid[0], def.centroid[1]]];
      regionPoints.push({ centroid: def.centroid, pts: seeds, name });
    }
    if (!regionPoints.length) { blobs[risk] = []; continue; }
    const visited = new Array(regionPoints.length).fill(false);
    const clusters = [];
    for (let i = 0; i < regionPoints.length; i++) {
      if (visited[i]) continue;
      const cluster = [i]; visited[i] = true;
      const queue = [i];
      while (queue.length) {
        const cur = queue.shift();
        for (let j = 0; j < regionPoints.length; j++) {
          if (visited[j]) continue;
          if (centroidDist(regionPoints[cur].centroid, regionPoints[j].centroid) <= GAP) {
            visited[j] = true; cluster.push(j); queue.push(j);
          }
        }
      }
      clusters.push(cluster);
    }
    blobs[risk] = clusters.map(cluster => {
      const allPts = cluster.flatMap(i => regionPoints[i].pts);
      const rawHull = convexHull(allPts);
      if (rawHull.length < 3) return null;
      const expandDist = expandBase + rIdx * expandStep;
      const expanded = expandPoly(rawHull, expandDist, 0);
      const hull = chaikin(expanded, 2);
      const cc = cluster.map(i => regionPoints[i].centroid);
      const labelLat = cc.reduce((s, p) => s + p[0], 0) / cc.length;
      const labelLon = cc.reduce((s, p) => s + p[1], 0) / cc.length;
      const regionNames = cluster.map(i => regionPoints[i].name);
      return { hull, regionNames, labelLat, labelLon, rIdx, color };
    }).filter(Boolean);
  }
  return blobs;
}

// ── TOMORROW.IO FETCH ──────────────────────────────────────────────────────────
async function fetchTomorrowPoint(lat, lon) {
  const fields = ["temperature","humidity","dewPoint","windGust","windSpeed","precipitationProbability","precipitationIntensity","weatherCode"].join(",");
  const url = `${TOMORROW_BASE}/weather/forecast?location=${lat},${lon}&fields=${fields}&timesteps=1h&units=metric&apikey=${TOMORROW_API_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) { const msg = await res.text().catch(() => ""); throw new Error(`Tomorrow.io HTTP ${res.status}: ${msg.slice(0, 120)}`); }
  const json = await res.json();
  const hourly = json?.timelines?.hourly ?? [];
  return hourly.map(h => ({
    time: h.time,
    temperature:              h.values?.temperature              ?? null,
    humidity:                 h.values?.humidity                 ?? null,
    dewPoint:                 h.values?.dewPoint                 ?? null,
    windGust:                 h.values?.windGust                 ?? null,
    windSpeed:                h.values?.windSpeed                ?? null,
    precipitationProbability: h.values?.precipitationProbability ?? null,
    precipitationIntensity:   h.values?.precipitationIntensity   ?? null,
    weatherCode:              h.values?.weatherCode              ?? null,
  }));
}

function aggregateTomorrowDays(hourlyArr, refDateStr) {
  if (!hourlyArr?.length) return null;
  const refDate = refDateStr ? new Date(refDateStr + "T00:00:00Z") : (() => { const d = new Date(); d.setUTCHours(0,0,0,0); return d; })();
  const days = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(refDate); d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), hours: [] };
  });
  for (const h of hourlyArr) {
    const dayObj = days.find(d => d.date === h.time?.slice(0, 10));
    if (dayObj) dayObj.hours.push(h);
  }
  return days.map(({ date, hours }) => {
    if (!hours.length) return null;
    const vals = k => hours.map(h => h[k]).filter(v => v != null);
    const avg  = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const max  = arr => arr.length ? Math.max(...arr) : null;
    const pps = vals("precipitationProbability"), gusts = vals("windGust"), rhs = vals("humidity"), dps = vals("dewPoint"), temps = vals("temperature"), precips = vals("precipitationIntensity");
    return { date, ppMax: max(pps), gustMax: max(gusts), rhAvg: avg(rhs), dewpointAvg: avg(dps), tempMax: max(temps), showersSum: precips.reduce((s,v)=>s+v,0), windGustMph: max(gusts)!=null?Math.round(max(gusts)*2.237):null, hourlyTmrw: hours };
  }).filter(Boolean);
}

async function fetchTomorrowForGrid(grid) {
  const seen = new Set(), repPoints = [];
  for (const pt of grid) { if (!seen.has(pt.name)) { seen.add(pt.name); repPoints.push(pt); } }
  const results = new Map();
  for (let i = 0; i < repPoints.length; i++) {
    const pt = repPoints[i];
    try {
      if (i > 0) await sleep(TOMORROW_RATE_LIMIT_MS);
      const hourly = await fetchTomorrowPoint(pt.lat, pt.lon);
      const days = aggregateTomorrowDays(hourly, hourly[0]?.time?.slice(0,10));
      if (days?.length) results.set(pt.name, days);
    } catch (e) { console.warn(`Tomorrow.io failed for ${pt.name}:`, e.message); }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── CUSTOM OPEN-METEO ENSEMBLE CLIENT ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * OpenMeteoEnsembleClient
 *
 * A self-contained, configurable client for the Open-Meteo Ensemble API.
 * Handles: model selection, variable selection, per-point caching with TTL,
 * exponential-backoff retry, graceful stale-cache fallback, multi-model
 * column merging, and typed 4-day day aggregation.
 *
 * TUNING:
 *   - MODELS: add/remove model strings to include/exclude ensemble members
 *   - HOURLY_VARS: add any hourly variable supported by the ensemble endpoint
 *   - DAILY_VARS: add any daily variable
 *   - CACHE_TTL_MS: how long a cached point is considered fresh (default 6h)
 *   - REQUEST_INTERVAL_MS: pause between consecutive point fetches (rate limit)
 *   - MAX_RETRIES / RETRY_BASE_MS: retry behaviour on transient errors
 *   - FORECAST_DAYS: number of days to request (1–7, default 4)
 */
class OpenMeteoEnsembleClient {
  // ── Configuration ────────────────────────────────────────────────────────
  static MODELS = [
    "icon_eu_eps",               // ICON-EU ensemble (Europe, 7km)
    "meteoswiss_icon_ch1_ensemble", // MeteoSwiss ICON-CH1 (Alpine focus)
    "ncep_gefs025",              // NOAA GEFS 0.25° global ensemble
    "ecmwf_ifs025_ensemble",     // ECMWF IFS 0.25° ensemble
    "ecmwf_aifs025_ensemble",    // ECMWF AIFS ML-based ensemble
    "ukmo_uk_ensemble_2km",      // UK Met Office UKV 2km ensemble
  ];

  static HOURLY_VARS = [
    "temperature_2m",            // Screen-level temperature (°C)
    "weather_code",              // WMO weather code
    "is_day",                    // 1 = daytime, 0 = night (for daytime CAPE)
    "wet_bulb_temperature_2m",   // Wet-bulb temperature — proxy for freezing level
    "cape",                      // Convective Available Potential Energy (J/kg) — PRIMARY instability
    "convective_inhibition",     // CIN (J/kg, negative convention on API, we abs())
    "precipitation",             // Total precipitation (mm/h) — shower activity proxy
  ];

  static DAILY_VARS = [
    "cape_mean",                 // Daily mean CAPE — smoothed instability signal
  ];

  static CACHE_TTL_MS        = 6 * 60 * 60 * 1000; // 6 hours — matches model update cadence
  static REQUEST_INTERVAL_MS = 120;                 // 120ms between requests — stay under rate limits
  static MAX_RETRIES         = 2;                   // Retry failed requests up to 2 times
  static RETRY_BASE_MS       = 1200;                // Base retry delay (doubles each attempt)
  static FORECAST_DAYS       = 4;                   // Days to fetch (1–7)
  static CACHE_PREFIX        = "tcm_om_pt_v3_";     // localStorage key prefix

  // ── Endpoint builder ──────────────────────────────────────────────────────
  static buildUrl(lat, lon) {
    const params = new URLSearchParams({
      latitude:       lat.toString(),
      longitude:      lon.toString(),
      hourly:         this.HOURLY_VARS.join(","),
      daily:          this.DAILY_VARS.join(","),
      models:         this.MODELS.join(","),
      timezone:       "auto",
      wind_speed_unit:"mph",
      forecast_days:  this.FORECAST_DAYS.toString(),
    });
    return `https://ensemble-api.open-meteo.com/v1/ensemble?${params.toString()}`;
  }

  // ── Cache helpers ─────────────────────────────────────────────────────────
  static getCacheKey(name) {
    return `${this.CACHE_PREFIX}${name.replace(/\s+/g, "_")}`;
  }

  static readCache(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts < this.CACHE_TTL_MS) return { fresh: true, data };
      return { fresh: false, data }; // stale but usable as fallback
    } catch { return null; }
  }

  static writeCache(key, data) {
    try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
  }

  // ── Fetch with retry ──────────────────────────────────────────────────────
  static async fetchWithRetry(url, attempt = 0) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(28000) });
      if (!res.ok) {
        // 429 = rate limited, 5xx = server error — both worth retrying
        if ((res.status === 429 || res.status >= 500) && attempt < this.MAX_RETRIES) {
          await sleep(this.RETRY_BASE_MS * Math.pow(2, attempt));
          return this.fetchWithRetry(url, attempt + 1);
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      if (attempt < this.MAX_RETRIES && e.name !== "AbortError") {
        await sleep(this.RETRY_BASE_MS * Math.pow(2, attempt));
        return this.fetchWithRetry(url, attempt + 1);
      }
      throw e;
    }
  }

  // ── Multi-model column merger ──────────────────────────────────────────────
  /**
   * Open-Meteo returns multi-model responses either as:
   *   (a) A merged array under the plain field name, or
   *   (b) Per-model columns named `field_modelname`
   * This method tries (a) first, then averages across all (b) columns.
   */
  static mergeModelColumns(hourly, fieldBase) {
    // Try plain field first
    if (hourly[fieldBase]?.some(v => v != null)) return hourly[fieldBase];
    // Collect all model-suffixed columns
    const cols = Object.keys(hourly)
      .filter(k => k === fieldBase || k.startsWith(fieldBase + "_"))
      .map(k => hourly[k])
      .filter(arr => arr?.some(v => v != null));
    if (!cols.length) return null;
    const len = cols[0].length;
    return Array.from({ length: len }, (_, i) => {
      const vals = cols.map(c => c[i]).filter(v => v != null);
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    });
  }

  // ── Day aggregation ───────────────────────────────────────────────────────
  /**
   * Takes the raw Open-Meteo hourly response and aggregates into 4 per-day
   * objects, each containing the convective parameters needed by the scorer.
   * Returns an array of length FORECAST_DAYS (zero-filled if data is short).
   */
  static aggregateDays(rawData) {
    const { hourly, daily } = rawData;
    if (!hourly) return null;

    const capeHourly = this.mergeModelColumns(hourly, "cape");
    const cinHourly  = this.mergeModelColumns(hourly, "convective_inhibition");
    const wbHourly   = this.mergeModelColumns(hourly, "wet_bulb_temperature_2m");
    const isDayArr   = this.mergeModelColumns(hourly, "is_day");
    const precipArr  = this.mergeModelColumns(hourly, "precipitation");
    const timeArr    = hourly.time ?? [];

    if (!capeHourly?.length) return null;

    const totalHours  = capeHourly.length;
    const hoursPerDay = 24;

    const avg  = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const max  = arr => arr.length ? Math.max(...arr) : 0;

    return Array.from({ length: this.FORECAST_DAYS }, (_, d) => {
      const s = d * hoursPerDay;
      const e = Math.min(s + hoursPerDay, totalHours);

      const sliceClean = arr => arr ? arr.slice(s, e).filter(v => v != null) : [];

      const capeSlice   = sliceClean(capeHourly);
      const cinSlice    = sliceClean(cinHourly);
      const wbSlice     = sliceClean(wbHourly);
      const precipSlice = sliceClean(precipArr);

      if (s >= totalHours) {
        // No data available for this day — return a zeroed placeholder
        return {
          date: timeArr[Math.min(s, totalHours - 1)]?.slice(0, 10) ?? "",
          capeMax: 0, capeAvg: 0, liMin: 5, cinMean: 0,
          freezingLevel: 2000, blHeight: 1400, wetBulbAvg: 0,
          windShear: 0, showersSum: 0, peakStart: 12, peakEnd: 18,
          hourlyConv: [],
        };
      }

      // Daily CAPE from model (better smoothed signal than hourly peak)
      const capeDailyKey = Object.keys(daily ?? {})
        .find(k => k === "cape_mean" || k.startsWith("cape_mean_"));
      const capeMeanDaily = capeDailyKey ? (daily[capeDailyKey]?.[d] ?? 0) : 0;

      // Daytime-only CAPE (more representative of peak instability)
      const daytimeCape = [];
      for (let h = s; h < e; h++) {
        if ((isDayArr?.[h] ?? 1) === 1 && capeHourly[h] != null) {
          daytimeCape.push(capeHourly[h]);
        }
      }

      const capeMax = Math.max(
        capeMeanDaily,
        max(capeSlice),
        daytimeCape.length ? Math.max(...daytimeCape) : 0
      );

      // Lifted Index approximation: LI ≈ -(CAPE / 120), clamp to [-10, 5]
      const liMin = capeMax > 0 ? Math.max(-10, -(capeMax / 120)) : 5;

      // Identify "active" hours: CAPE > 150 AND CIN < 80 J/kg
      const hotHours = [];
      for (let h = s; h < e; h++) {
        const cape = capeHourly[h] ?? 0;
        const cin  = Math.abs(cinHourly?.[h] ?? 0);
        if (cape > 150 && cin < 80) hotHours.push(h - s);
      }

      const activeCinMean = hotHours.length
        ? hotHours.reduce((sm, h) => sm + Math.abs(cinHourly?.[s + h] ?? 0), 0) / hotHours.length
        : Math.abs(avg(cinSlice));

      const wbAvg         = avg(wbSlice);
      // Freezing level height (m) from wet-bulb temp: ~180m per °C above 0
      const freezingLevel = wbAvg > 0 ? Math.min(5500, wbAvg * 180) : 2000;
      // Boundary layer height approximation
      const blHeight      = freezingLevel * 0.7;
      // Wind shear proxy from freezing level (capped at 25 kt equivalent)
      const windShear     = Math.min(25, freezingLevel / 200);

      const date = timeArr[s]?.slice(0, 10) ?? "";

      // Hourly breakdown for the playback modal
      const hourlyConv = [];
      for (let h = s; h < e; h++) {
        hourlyConv.push({
          hour: h - s,
          cape: capeHourly?.[h] ?? 0,
          li:   liMin,
          cin:  Math.abs(cinHourly?.[h] ?? 0),
        });
      }

      return {
        date, capeMax, capeAvg: avg(capeSlice), liMin,
        cinMean: activeCinMean, freezingLevel, blHeight,
        wetBulbAvg: wbAvg, windShear,
        showersSum: precipSlice.reduce((a, b) => a + b, 0),
        peakStart: hotHours.length ? hotHours[0] : 12,
        peakEnd:   hotHours.length ? hotHours[hotHours.length - 1] : 18,
        hourlyConv,
      };
    });
  }

  // ── Main fetch entry point ────────────────────────────────────────────────
  /**
   * Fetches ensemble convective data for every unique region in grid.
   * Returns an array of { _pt, ...rawOMResponse } objects, one per region.
   * Uses cache-first strategy with stale fallback on errors.
   */
  static async fetchForGrid(grid) {
    // Deduplicate: one API call per unique region name
    const seen         = new Set();
    const uniquePoints = [];
    for (const pt of grid) {
      if (!seen.has(pt.name)) { seen.add(pt.name); uniquePoints.push(pt); }
    }

    const results = [];

    for (let i = 0; i < uniquePoints.length; i++) {
      const pt       = uniquePoints[i];
      const cacheKey = this.getCacheKey(pt.name);

      // 1. Try fresh cache
      const cached = this.readCache(cacheKey);
      if (cached?.fresh) {
        results.push({ _pt: pt, ...cached.data });
        continue;
      }

      // 2. Rate-limit pause between live requests
      if (i > 0) await sleep(this.REQUEST_INTERVAL_MS);

      // 3. Attempt live fetch
      try {
        const url  = this.buildUrl(pt.lat, pt.lon);
        const json = await this.fetchWithRetry(url);
        const data = Array.isArray(json) ? json[0] : json;

        this.writeCache(cacheKey, data);
        results.push({ _pt: pt, ...data });
      } catch (e) {
        console.warn(`[OpenMeteoClient] Failed for ${pt.name}:`, e.message);

        // 4. Stale cache fallback — better than nothing
        if (cached?.data) {
          console.info(`[OpenMeteoClient] Using stale cache for ${pt.name}`);
          results.push({ _pt: pt, ...cached.data });
        }
        // If no stale cache, skip this point silently
      }
    }

    return results;
  }
}

// ── Public wrapper (drop-in replacement for old fetchOpenMeteoConvective) ────
async function fetchOpenMeteoConvective(grid) {
  return OpenMeteoEnsembleClient.fetchForGrid(grid);
}

// ── Public wrapper for day aggregation ───────────────────────────────────────
function aggregateOMConvectiveDays(omData) {
  return OpenMeteoEnsembleClient.aggregateDays(omData);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── CUSTOM CONVECTIVE SCORING SYSTEM ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * ConvectiveScorer
 *
 * A per-hazard, table-driven scoring engine. Each hazard type has its own
 * weight table. Scores from multiple parameter categories are summed, then
 * modified by CIN suppression and shear/moisture amplifiers, before being
 * mapped to a named risk level.
 *
 * ARCHITECTURE:
 *   1. CAPE score       — primary driver of raw instability
 *   2. Lifted Index     — secondary instability confirmation
 *   3. Moisture score   — dewpoint + relative humidity
 *   4. Precipitation    — shower/rain activity proxy
 *   5. Wind / shear     — organisation and severity amplifier
 *   6. Synoptic bonus   — extra points when multiple drivers align
 *   7. CIN suppression  — reduces score when stable cap is too strong
 *   8. Type modifier    — hazard-specific bonus/penalty logic
 *   9. Lightning boost  — real-time strike injection (day 0 only)
 *  10. Threshold map    — continuous score → RISK_ORDER label
 *
 * TUNING GUIDE:
 *   - All weight tables are plain objects — edit the numbers directly.
 *   - RISK_THRESHOLDS maps minimum score → risk label. Lower a threshold to
 *     make that risk level easier to reach; raise it to restrict it.
 *   - CIN_SUPPRESSION.curve: each entry is { minCin, penalty }. When CIN
 *     exceeds minCin (abs value), subtract penalty points.
 *   - TYPE_MODIFIERS: add a new key matching a RISK_TYPES id, then add
 *     requiredFor/bonusFor/penalty logic as needed.
 */
class ConvectiveScorer {

  // ── Risk thresholds ────────────────────────────────────────────────────────
  // Minimum score required to reach each risk level (inclusive lower bound).
  // Adjust these to recalibrate the overall sensitivity of the system.
  static RISK_THRESHOLDS = [
    { min: 88, label: "Severe"   },  // rare catastrophic events
    { min: 70, label: "High"     },  // major severe weather outbreak
    { min: 50, label: "Moderate" },  // organised convection likely
    { min: 33, label: "Marginal" },  // isolated severe possible
    { min: 18, label: "Low"      },  // general thunderstorm risk
    { min:  7, label: "Very Low" },  // background shower risk
    { min:  0, label: "No Risk"  },  // stable — nothing expected
  ];

  // ── CAPE weight table ──────────────────────────────────────────────────────
  // Points awarded for Convective Available Potential Energy (J/kg).
  // This is the single most important driver — adjust proportionally.
  static CAPE_WEIGHTS = [
    { min: 3000, pts: 62 },   // extreme CAPE — severe multi-cellular or supercell
    { min: 2000, pts: 54 },   // very high — well-organised storms likely
    { min: 1500, pts: 45 },   // high — active convection with severe potential
    { min: 1000, pts: 35 },   // moderate-high — convective development probable
    { min:  600, pts: 25 },   // moderate — scattered storms with some organisation
    { min:  300, pts: 17 },   // low-moderate — isolated active storms possible
    { min:  150, pts: 10 },   // low — marginal convection, brief storms only
    { min:   50, pts:  5 },   // very low — brief, pulse-type activity only
    { min:   20, pts:  2 },   // trace — background signal, may trigger very isolated
    { min:    0, pts:  0 },
  ];

  // ── Lifted Index weight table ──────────────────────────────────────────────
  // LI < 0 = unstable; more negative = more unstable. Calculated from CAPE.
  static LI_WEIGHTS = [
    { maxLI: -10, pts: 30 }, // extremely unstable
    { maxLI:  -8, pts: 25 },
    { maxLI:  -6, pts: 19 },
    { maxLI:  -4, pts: 13 },
    { maxLI:  -2, pts:  7 },
    { maxLI:   0, pts:  3 },
    { maxLI:  99, pts:  0 }, // stable or neutral
  ];

  // ── Moisture weight tables ─────────────────────────────────────────────────
  // Dewpoint (°C) and Relative Humidity (%) contribute independently.
  static DEWPOINT_WEIGHTS = [
    { min: 18, pts: 12 }, // tropical moisture — very high latent heat
    { min: 15, pts:  9 }, // warm season UK maximum
    { min: 12, pts:  6 }, // summer average, good moisture for UK
    { min:  9, pts:  3 }, // marginal moisture
    { min:  6, pts:  1 }, // limited moisture
    { min:  0, pts:  0 },
  ];

  static RH_WEIGHTS = [
    { min: 90, pts: 15 }, // saturated boundary layer — very moist, deep cloud
    { min: 85, pts: 12 },
    { min: 75, pts:  8 },
    { min: 65, pts:  4 },
    { min: 55, pts:  2 },
    { min:  0, pts:  0 },
  ];

  // ── Precipitation weight table ─────────────────────────────────────────────
  // Shower/rain activity (mm total) — proxy for active convection already underway.
  static PRECIP_WEIGHTS = [
    { min: 20, pts: 14 }, // heavy shower activity — clear convective signal
    { min: 10, pts: 10 },
    { min:  5, pts:  7 },
    { min:  1, pts:  4 },
    { min:  0.3, pts: 2 },
    { min:  0, pts:  0 },
  ];

  // ── Precipitation probability weight table ────────────────────────────────
  static PP_WEIGHTS = [
    { min: 90, pts: 13 },
    { min: 80, pts: 11 },
    { min: 60, pts:  8 },
    { min: 40, pts:  5 },
    { min: 20, pts:  2 },
    { min:  0, pts:  0 },
  ];

  // ── Wind / gust weight table ───────────────────────────────────────────────
  // Surface gust (m/s from Tomorrow.io). Contributes to cell organisation.
  static GUST_WEIGHTS = [
    { min: 30, pts: 10 },
    { min: 22, pts:  7 },
    { min: 16, pts:  5 },
    { min: 10, pts:  2 },
    { min:  0, pts:  0 },
  ];

  // ── Wind shear weight table ────────────────────────────────────────────────
  // Derived from freezing level. High shear = organised, severe-capable storms.
  static SHEAR_WEIGHTS = [
    { min: 22, pts: 14 }, // supercell-supporting shear
    { min: 17, pts: 10 },
    { min: 12, pts:  6 },
    { min:  7, pts:  3 },
    { min:  0, pts:  0 },
  ];

  // ── Temperature weight table ───────────────────────────────────────────────
  // High surface temps increase surface-based CAPE and trigger initiation.
  static TEMP_WEIGHTS = [
    { min: 30, pts: 7 }, // exceptional UK heat
    { min: 25, pts: 5 },
    { min: 20, pts: 2 },
    { min:  0, pts: 0 },
  ];

  // ── CIN suppression curve ──────────────────────────────────────────────────
  // CIN (J/kg, abs value) reduces the final score — strong cap prevents storms.
  // Penalty is subtracted BEFORE the risk threshold lookup.
  static CIN_SUPPRESSION = [
    { minCin: 200, penalty: 38 }, // very strong cap — storms almost impossible
    { minCin: 150, penalty: 26 },
    { minCin: 100, penalty: 17 },
    { minCin:  60, penalty: 10 },
    { minCin:  30, penalty:  4 },
    { minCin:   0, penalty:  0 },
  ];

  // ── Synoptic bonus ────────────────────────────────────────────────────────
  // Extra points when multiple favourable conditions align together.
  // Each entry: { conditions: [fn, fn, ...], bonus }
  // All condition functions must return true for the bonus to apply.
  static SYNOPTIC_BONUSES = [
    // Classic severe setup: high CAPE + strong shear + moist BL
    { conditions: [(m) => m.capeMax >= 1500, (m) => m.windShear >= 15, (m) => m.rhAvg >= 75], bonus: 10 },
    // Marginal but organised setup
    { conditions: [(m) => m.capeMax >= 800,  (m) => m.windShear >= 10, (m) => m.dewpointAvg >= 12], bonus: 5 },
    // Strong moisture + high shower probability — likely thundery
    { conditions: [(m) => m.rhAvg >= 85, (m) => m.ppMax >= 70, (m) => m.showersSum >= 5], bonus: 6 },
    // Very high CAPE alone is a partial bonus (even without perfect moisture)
    { conditions: [(m) => m.capeMax >= 2500], bonus: 4 },
  ];

  // ── Type-specific modifier tables ─────────────────────────────────────────
  // Each type can define { bonus, penalty } applied after the base score.
  // Return value is a delta (positive or negative) to add.
  static TYPE_MODIFIERS = {

    thunderstorm: (m, baseScore) => {
      let delta = 0;
      // Synergistic boost when CAPE, moisture and shower activity align
      if (m.capeMax >= 500 && m.rhAvg >= 70 && m.ppMax >= 50) delta += 6;
      // Organised shear-driven storms amplify thunderstorm threat significantly
      if (m.windShear >= 15 && m.capeMax >= 1000) delta += 7;
      // Very active shower day with moisture — even without huge CAPE
      if (m.showersSum >= 10 && m.rhAvg >= 80 && m.capeMax >= 200) delta += 4;
      return delta;
    },

    hail: (m, baseScore) => {
      let delta = 0;
      // Hail requires both instability AND wind speed to lift hailstones
      if (m.capeMax < 600 && m.gustMax < 14) delta -= 30; // strong penalty without both
      else if (m.capeMax < 600 || m.gustMax < 12) delta -= 15;
      // Large hail corridor: high CAPE + strong gust + wind shear
      if (m.capeMax >= 2500 && m.gustMax >= 22 && m.windShear >= 15) delta += 20;
      else if (m.capeMax >= 1500 && m.gustMax >= 18 && m.windShear >= 10) delta += 12;
      else if (m.capeMax >= 800  && m.gustMax >= 14) delta += 6;
      // High freezing level = larger hailstones survive longer
      if (m.freezingLevel >= 4000 && m.capeMax >= 1000) delta += 5;
      return delta;
    },

    tornado: (m, baseScore) => {
      let delta = 0;
      // Tornadoes need very specific setup — apply large base penalty
      delta -= 38;
      // Classic supercell tornado setup
      if (m.capeMax >= 1500 && m.liMin <= -6 && m.gustMax >= 24 && m.windShear >= 15 && m.cinMean < 60) delta += 24;
      else if (m.capeMax >= 1000 && m.liMin <= -5 && m.gustMax >= 18 && m.windShear >= 10) delta += 16;
      else if (m.capeMax >= 600  && m.liMin <= -4 && m.gustMax >= 16 && m.windShear >= 8)  delta += 10;
      else if (m.capeMax >= 300  && m.liMin <= -3 && m.gustMax >= 14) delta += 5;
      // High low-level moisture aids boundary layer convergence
      if (m.rhAvg >= 85 && m.gustMax >= 14 && m.cinMean < 40) delta += 6;
      // Marginal CAPE with very strong shear — elevated tornado risk (QLCS type)
      if (m.capeMax >= 200 && m.windShear >= 20) delta += 5;
      return delta;
    },

    lightning: (m, baseScore) => {
      let delta = 0;
      // Lightning is closely tied to any convective activity with moisture
      if (m.capeMax >= 200 && m.rhAvg >= 60) delta += 8;
      // Any shower activity is a strong indicator of strike potential
      if (m.showersSum >= 1) delta += 6;
      // Moist boundary layer aids electrification
      if (m.dewpointAvg >= 10) delta += 4;
      // Organised shear increases charge separation in stronger updrafts
      if (m.windShear >= 10) delta += 4;
      // Even marginal CAPE with very high RH can produce lightning
      if (m.capeMax >= 100 && m.rhAvg >= 85) delta += 3;
      return delta;
    },
  };

  // ── Score from weight table ────────────────────────────────────────────────
  static fromTable(value, table, valueKey = "min") {
    if (valueKey === "maxLI") {
      // LI table uses max threshold (less-than comparison)
      const entry = table.find(e => value <= e.maxLI);
      return entry ? entry.pts : 0;
    }
    // Default: descending minimum threshold
    const entry = table.find(e => value >= e.min);
    return entry ? entry.pts : 0;
  }

  // ── Main scoring entry point ───────────────────────────────────────────────
  /**
   * @param {object} m          - Merged metric object for the region/day
   * @param {string} type       - Hazard type id (matches RISK_TYPES[].id)
   * @param {number} lightningBoost - Optional real-time lightning strike bonus
   * @returns {string} Risk level label from RISK_ORDER
   */
  static score(m, type, lightningBoost = 0) {
    const cape    = m.capeMax       ?? 0;
    const li      = m.liMin         ?? 5;
    const rh      = m.rhAvg         ?? 0;
    const pp      = m.ppMax         ?? 0;
    const gust    = m.gustMax       ?? 0;
    const cin     = Math.abs(m.cinMean ?? 0);
    const showers = m.showersSum    ?? 0;
    const dp      = m.dewpointAvg   ?? 5;
    const tmax    = m.tempMax       ?? 10;
    const shear   = m.windShear     ?? 0;

    // ── 1. Component scores ────────────────────────────────────────────────
    let score = 0;
    score += this.fromTable(cape,    this.CAPE_WEIGHTS);
    score += this.fromTable(li,      this.LI_WEIGHTS, "maxLI");
    score += this.fromTable(rh,      this.RH_WEIGHTS);
    score += this.fromTable(dp,      this.DEWPOINT_WEIGHTS);
    score += this.fromTable(pp,      this.PP_WEIGHTS);
    score += this.fromTable(showers, this.PRECIP_WEIGHTS);
    score += this.fromTable(gust,    this.GUST_WEIGHTS);
    score += this.fromTable(shear,   this.SHEAR_WEIGHTS);
    score += this.fromTable(tmax,    this.TEMP_WEIGHTS);

    // ── 2. Synoptic bonus ──────────────────────────────────────────────────
    for (const { conditions, bonus } of this.SYNOPTIC_BONUSES) {
      if (conditions.every(fn => fn(m))) score += bonus;
    }

    // ── 3. CIN suppression ─────────────────────────────────────────────────
    const cinEntry = this.CIN_SUPPRESSION.find(e => cin >= e.minCin);
    if (cinEntry) score = Math.max(0, score - cinEntry.penalty);

    // ── 4. Type-specific modifier ──────────────────────────────────────────
    const modifier = this.TYPE_MODIFIERS[type];
    if (modifier) score += modifier(m, score);

    // ── 5. Real-time lightning boost (day 0 only) ──────────────────────────
    score += lightningBoost;

    // ── 6. Clamp to [0, 110] ──────────────────────────────────────────────
    score = Math.max(0, Math.min(110, score));

    // ── 7. Map to risk label ───────────────────────────────────────────────
    const entry = this.RISK_THRESHOLDS.find(e => score >= e.min);
    return entry ? entry.label : "No Risk";
  }
}

// ── Public wrapper (drop-in for old scoreRisk function) ──────────────────────
function scoreRisk(m, type, baseMultiplier = 1.0, lightningBoost = 0) {
  // baseMultiplier is retained for API compatibility but no longer used
  // in the new scorer — all calibration is done in the weight tables above.
  return ConvectiveScorer.score(m, type, lightningBoost);
}

// ── LIGHTNING BOOST ────────────────────────────────────────────────────────────
function computeLightningBoost(strikes, regionDef) {
  if (!strikes?.length || !regionDef) return 0;
  const poly = regionDef.polygon; if (!poly?.length) return 0;
  const minLat = Math.min(...poly.map(p => p[0])) - 0.4, maxLat = Math.max(...poly.map(p => p[0])) + 0.4;
  const minLon = Math.min(...poly.map(p => p[1])) - 0.6, maxLon = Math.max(...poly.map(p => p[1])) + 0.6;
  const count = strikes.filter(s => s.lat >= minLat && s.lat <= maxLat && s.lon >= minLon && s.lon <= maxLon).length;
  if (count === 0) return 0;
  if (count < 3)  return Math.round(count * 2);
  if (count < 10) return Math.round(6 + (count - 3) * 0.9);
  if (count < 30) return Math.round(12 + (count - 10) * 0.55);
  return Math.min(28, Math.round(23 + (count - 30) * 0.25));
}

// ── MERGE ─────────────────────────────────────────────────────────────────────
function mergeTomorrowOMDay(tmrwDay, omDay, date) {
  const tm = tmrwDay ?? {}, om = omDay ?? {};
  const capeMax = om.capeMax ?? 0, capeAvg = om.capeAvg ?? 0, liMin = om.liMin ?? 5;
  const cinMean = om.cinMean ?? 0, windShear = om.windShear ?? 0;
  const freezingLevel = om.freezingLevel ?? 0, blHeight = om.blHeight ?? 0;
  const wetBulbAvg = om.wetBulbAvg ?? 0, peakStart = om.peakStart ?? 12, peakEnd = om.peakEnd ?? 18;
  const rhAvg = tm.rhAvg ?? 70, dewpointAvg = tm.dewpointAvg ?? 8;
  const tempMax = tm.tempMax ?? 15, gustMax = tm.gustMax ?? 10;
  const ppMax = tm.ppMax ?? 0, showersSum = tm.showersSum ?? 0;
  const windGust = tm.windGustMph ?? Math.round((tm.gustMax ?? 10) * 2.237);
  const rainRate = tm.hourlyTmrw?.length
    ? Math.round(tm.hourlyTmrw.reduce((s, h) => s + (h.precipitationIntensity ?? 0), 0) / tm.hourlyTmrw.length)
    : 0;
  const hailMm       = capeMax > 800 ? Math.round(5 + (capeMax - 800) / 80) : 0;
  const lightningPct = Math.min(99, Math.round(capeMax / 20 * 0.5 + ppMax * 0.5));
  const omHourly     = om.hourlyConv ?? [], tmHourly = tm.hourlyTmrw ?? [];
  const hourlyData   = Array.from({ length: Math.max(omHourly.length, tmHourly.length) }, (_, i) => {
    const o = omHourly[i] ?? {}, t = tmHourly[i] ?? {};
    return { hour: i, cape: o.cape ?? 0, li: o.li ?? 5, cin: o.cin ?? 0, rh: t.humidity ?? rhAvg, pp: t.precipitationProbability ?? ppMax, gust: t.windGust ?? gustMax, dp: t.dewPoint ?? dewpointAvg, t: t.temperature ?? tempMax };
  });
  return { date, capeMax, capeAvg, liMin, cinMean, windShear, freezingLevel, blHeight, wetBulbAvg, rhAvg, dewpointAvg, tempMax, gustMax, ppMax, showersSum, windGust, rainRate, hailMm, lightningPct, peakStart, peakEnd, hourlyData, _tmrw: tm, _om: om };
}

// ── BUILD FORECASTS ────────────────────────────────────────────────────────────
function buildForecasts(omPointResults, tomorrowMap, regionDefs, isEurope, isUSA, lightningStrikes = []) {
  const nDays = 4;
  const out = {};
  RISK_TYPES.forEach(({ id: type }) => {
    out[type] = Array.from({ length: nDays }, (_, di) => {
      const regionAccumulator = {};
      omPointResults.forEach(({ name, omDays }) => {
        const omDay = omDays?.[di]; if (!omDay) return;
        const merged = mergeTomorrowOMDay(tomorrowMap?.get(name)?.[di] ?? null, omDay, omDay.date ?? "");
        if (!regionAccumulator[name]) regionAccumulator[name] = [];
        regionAccumulator[name].push(merged);
      });
      const regions = {};
      let sumCape = 0, sumRH = 0, sumGust = 0, count = 0, allMetrics = null;
      for (const [name, metricArr] of Object.entries(regionAccumulator)) {
        const worstCape = Math.max(...metricArr.map(m => m.capeMax));
        const worstLI   = Math.min(...metricArr.map(m => m.liMin));
        const n         = metricArr.length;
        const avgF      = key => metricArr.reduce((s, m) => s + (m[key] ?? 0), 0) / n;
        const worstPt   = metricArr.find(m => m.capeMax === worstCape) ?? metricArr[0];
        const representative = {
          ...worstPt, capeMax: worstCape, capeAvg: avgF("capeAvg"), liMin: worstLI,
          rhAvg: avgF("rhAvg"), ppMax: avgF("ppMax"), gustMax: avgF("gustMax"),
          showersSum: avgF("showersSum"), cinMean: avgF("cinMean"),
          dewpointAvg: avgF("dewpointAvg"), tempMax: avgF("tempMax"),
          windShear: avgF("windShear"), windGust: Math.round(avgF("gustMax") * 2.237),
        };
        const def    = regionDefs[name];
        const lBoost = (di === 0 && (type === "thunderstorm" || type === "lightning"))
          ? computeLightningBoost(lightningStrikes, def) : 0;
        regions[name] = { risk: scoreRisk(representative, type, 1.0, lBoost), ...representative, lightningBoost: lBoost };
        sumCape += representative.capeMax;
        sumRH   += representative.rhAvg;
        sumGust += representative.gustMax;
        count++;
        if (!allMetrics) allMetrics = representative;
      }
      const avgCape = count ? sumCape / count : 0;
      const avgRH   = count ? sumRH   / count : 60;
      const avgGust = count ? sumGust  / count : 0;
      const sample  = allMetrics ?? {};
      const riskIdxes  = Object.values(regions).map(r => RISK_ORDER.indexOf(r.risk)).filter(v => v >= 0);
      const minRisk    = RISK_ORDER[Math.min(...riskIdxes)] ?? "No Risk";
      const maxRisk    = RISK_ORDER[Math.max(...riskIdxes)] ?? "No Risk";
      const overallRisk = scoreRisk({ ...sample, capeMax: avgCape, capeAvg: avgCape * 0.6, rhAvg: avgRH, gustMax: avgGust }, type);
      const dateStr     = omPointResults[0]?.omDays?.[di]?.date ?? "";
      const dayLabel    = di === 0 ? "Today" : di === 1 ? "Tomorrow" : `Day ${di + 1}`;
      const formattedDate = dateStr ? new Date(dateStr + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : "";
      const preBuiltBlobs = buildRiskBlobs(regions, RISK_TYPES.find(t => t.id === type)?.colors ?? [], regionDefs);
      return { date: dateStr, dayLabel, formattedDate, type, overallRisk, minRisk, maxRisk, avgCape: Math.round(avgCape), avgRH: Math.round(avgRH), regions, preBuiltBlobs };
    });
  });
  return out;
}

// ── BLITZORTUNG ───────────────────────────────────────────────────────────────
const BO_SERVERS = ["wss://ws1.blitzortung.org", "wss://ws7.blitzortung.org", "wss://ws8.blitzortung.org"];

function blitzortungDecode(raw) {
  try {
    const d = Array.from(raw); if (!d.length) return null;
    const e = {}; let c = d[0], f = c; const g = [c]; let h = 256, o = h;
    for (let i = 1; i < d.length; i++) {
      const code = d[i].charCodeAt(0); let a;
      if (h > code) a = d[i]; else if (e[code] !== undefined) a = e[code]; else a = f + c;
      g.push(a); c = a[0]; e[o] = f + c; o++; f = a;
    }
    return JSON.parse(g.join(""));
  } catch (_) { return null; }
}

function inBoundsUK(lat, lon) {
  return (lat >= 49.0 && lat <= 61.0 && lon >= -11.0 && lon <= 2.0) ||
         (lat >= 48.5 && lat <= 51.2 && lon >= -2.0  && lon <= 3.0);
}

function connectBlitzortung(onStrike, onStatusChange) {
  let stopped = false, ws = null, serverIdx = 0, reconnectTimer = null;
  function connect() {
    if (stopped) return;
    const url = BO_SERVERS[serverIdx % BO_SERVERS.length]; serverIdx++;
    onStatusChange("connecting");
    try { ws = new WebSocket(url); } catch (_) { scheduleReconnect(); return; }
    ws.onopen  = () => { if (stopped) { ws.close(); return; } onStatusChange("live"); try { ws.send(JSON.stringify({ a: 111 })); } catch (_) {} };
    ws.onmessage = (evt) => {
      if (stopped) return;
      try {
        const raw = evt.data; let parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) {}
        if (!parsed) parsed = blitzortungDecode(raw);
        if (!parsed) return;
        const strikes = parsed.strikes || (parsed.lat !== undefined ? [parsed] : null);
        if (!strikes) return;
        const nowMs = Date.now();
        strikes.forEach(s => {
          let timeMs = s.time ? (s.time > 1e12 ? Math.floor(s.time / 1e6) : s.time * 1000) : nowMs;
          let lat = s.lat, lon = s.lon;
          if (Math.abs(lat) > 90) lat = lat / 1e7;
          if (Math.abs(lon) > 180) lon = lon / 1e7;
          if (isNaN(lat) || isNaN(lon)) return;
          if (!inBoundsUK(lat, lon)) return;
          onStrike({ lat, lon, time: timeMs, amp: s.mamp || 0 });
        });
      } catch (_) {}
    };
    ws.onerror = () => { scheduleReconnect(); };
    ws.onclose = () => { if (!stopped) scheduleReconnect(); };
  }
  function scheduleReconnect(ms = 5000) {
    if (stopped) return;
    onStatusChange("connecting");
    reconnectTimer = setTimeout(connect, ms);
  }
  connect();
  return () => { stopped = true; clearTimeout(reconnectTimer); try { ws && ws.close(); } catch (_) {} };
}

// ── LEAFLET ───────────────────────────────────────────────────────────────────
let _lfPromise = null;
function loadLeaflet() {
  if (_lfPromise) return _lfPromise;
  _lfPromise = new Promise(resolve => {
    if (window.L) { resolve(); return; }
    if (!document.getElementById("lf-css")) {
      const l = document.createElement("link");
      l.id = "lf-css"; l.rel = "stylesheet";
      l.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(l);
    }
    const s = document.createElement("script");
    s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    s.onload = resolve;
    document.head.appendChild(s);
  });
  return _lfPromise;
}

// ── SEVERE HATCH PATTERN ──────────────────────────────────────────────────────
function ensureSevereHatchPattern() {
  if (document.getElementById("tcm-severe-hatch")) return;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("id", "tcm-severe-hatch-defs");
  svg.style.position = "absolute"; svg.style.width = "0"; svg.style.height = "0"; svg.style.overflow = "hidden";
  const defs = document.createElementNS(ns, "defs");
  const pattern = document.createElementNS(ns, "pattern");
  pattern.setAttribute("id", "tcm-severe-hatch");
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  pattern.setAttribute("width", "8"); pattern.setAttribute("height", "8");
  pattern.setAttribute("patternTransform", "rotate(45 0 0)");
  const line = document.createElementNS(ns, "line");
  line.setAttribute("x1", "0"); line.setAttribute("y1", "0");
  line.setAttribute("x2", "0"); line.setAttribute("y2", "8");
  line.setAttribute("stroke", "#111111"); line.setAttribute("stroke-width", "3.5");
  pattern.appendChild(line); defs.appendChild(pattern); svg.appendChild(defs);
  document.body.appendChild(svg);
}

function drawBlobsOnLayer(L, layerRef, blobs, regionData, typeColors) {
  layerRef.clearLayers();
  ensureSevereHatchPattern();
  const drawnPolygons = [];
  for (let rIdx = 1; rIdx <= 6; rIdx++) {
    const risk = RISK_ORDER[rIdx], color = typeColors[rIdx], clusters = blobs[risk];
    if (!clusters?.length) continue;
    const isSevere = rIdx === 6;
    for (const { hull, regionNames, labelLat, labelLon } of clusters) {
      if (hull.length < 3) continue;
      // The hull arrives ALREADY expanded by buildRiskBlobs(). Don't re-expand
      // it here — that's what was pushing the polygon out into the sea. We
      // still apply a tiny smoothing pass for visual softness, and a very
      // small halo offset, but no aggressive second expansion.
      const haloRing = chaikin(expandPoly(hull, 0.05, 0.02), 2);
      const coreRing = chaikin(hull, 3);
      if (isSevere) {
        L.polygon(coreRing, { color: "#000000", fillColor: "#111111", fillOpacity: 0.55, weight: 3.0, opacity: 1.0, className: "tcm-severe-polygon" }).addTo(layerRef);
        const hatchOverlay = L.polygon(coreRing, { color: "transparent", fillColor: "#ffffff", fillOpacity: 0.0, weight: 0, className: "tcm-severe-hatch-overlay" }).addTo(layerRef);
        setTimeout(() => {
          try { const el = hatchOverlay.getElement(); if (el) { el.querySelector("path")?.setAttribute("fill", "url(#tcm-severe-hatch)"); el.querySelector("path")?.setAttribute("fill-opacity", "0.45"); } } catch (_) {}
        }, 50);
        L.polygon(haloRing, { color: "#000000", fillColor: "#000000", fillOpacity: 0.08, weight: 0 }).addTo(layerRef);
      } else {
        L.polygon(haloRing, { color, fillColor: color, fillOpacity: 0.04 + rIdx * 0.008, weight: 0 }).addTo(layerRef);
        L.polygon(coreRing, { color, fillColor: color, fillOpacity: 0.18 + rIdx * 0.045, weight: rIdx >= 2 ? 1.5 : 1.0, opacity: 0.85, dashArray: rIdx === 1 ? "5 4" : null }).addTo(layerRef);
      }
      drawnPolygons.push({ rIdx, coreRing });
    }
  }
  function pointInPolygon(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  for (let rIdx = 1; rIdx <= 6; rIdx++) {
    const risk = RISK_ORDER[rIdx], color = typeColors[rIdx], clusters = blobs[risk];
    if (!clusters?.length) continue;
    const labelColor  = rIdx === 6 ? "#ffffff" : color;
    const labelShadow = rIdx === 6 ? "0 1px 4px #000,0 0 3px #000,0 0 1px #fff" : "0 1px 6px #000,0 0 2px #000";
    for (const { hull, regionNames, labelLat, labelLon } of clusters) {
      if (hull.length < 3) continue;
      const coveredByHigher = drawnPolygons.some(dp => dp.rIdx > rIdx && pointInPolygon([labelLat, labelLon], dp.coreRing));
      if (!coveredByHigher) {
        L.marker([labelLat, labelLon], { icon: L.divIcon({ className: "", html: `<div style="font-size:10px;font-weight:800;color:${labelColor};text-shadow:${labelShadow};white-space:nowrap;letter-spacing:0.08em;text-transform:uppercase;pointer-events:none">${risk}</div>`, iconAnchor: [24, 8] }), interactive: false }).addTo(layerRef);
        if (rIdx >= 4) {
          const peakStart = Math.min(...regionNames.map(n => regionData[n]?.peakStart ?? 15));
          const peakEnd   = Math.max(...regionNames.map(n => regionData[n]?.peakEnd   ?? 20));
          L.marker([labelLat - 0.4, labelLon], { icon: L.divIcon({ className: "", html: `<div style="font-size:8.5px;color:${labelColor}bb;text-shadow:0 0 5px #000;white-space:nowrap;pointer-events:none">${peakStart}:00–${peakEnd}:00Z</div>`, iconAnchor: [28, -2] }), interactive: false }).addTo(layerRef);
        }
      }
    }
  }
}

async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=en`);
    const d = await r.json();
    return d.address?.city || d.address?.town || d.address?.village || d.address?.county || d.display_name?.split(",")[0] || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  } catch { return `${lat.toFixed(2)}, ${lon.toFixed(2)}`; }
}

// ── RISK MAP ──────────────────────────────────────────────────────────────────
function RiskMap({ regionData, typeColors, activeTypObj, preBuiltBlobs = null, lightMode = false, regionDefs = null, isEurope = false, isUSA = false, lightningStrikes = [], showLightning = true, mapId = "main" }) {
  const mapRef = useRef(null), mapInst = useRef(null), layerRef = useRef(null), strikesRef = useRef(null), markerRef = useRef(null);
  const [ready, setReady] = useState(false), [clickInfo, setClickInfo] = useState(null), [fullscreen, setFullscreen] = useState(false);
  useEffect(() => { if (!mapInst.current) return; setTimeout(() => { mapInst.current?.invalidateSize(); }, 50); }, [fullscreen]);
  useEffect(() => { loadLeaflet().then(() => setReady(true)); }, []);
  useEffect(() => { if (!mapInst.current) return; if (fullscreen) mapInst.current.scrollWheelZoom.enable(); else mapInst.current.scrollWheelZoom.disable(); }, [fullscreen, ready]);
  useEffect(() => {
    if (!ready || !mapRef.current || mapInst.current) return;
    const L = window.L; if (mapRef.current._leaflet_id) delete mapRef.current._leaflet_id;
    mapInst.current = L.map(mapRef.current, { center: isUSA ? [38, -96] : isEurope ? [52, 12] : [54.0, -4.5], zoom: isUSA ? 4 : isEurope ? 4 : 5, zoomControl: true, attributionControl: false, scrollWheelZoom: false, doubleClickZoom: true, touchZoom: true });
    if (isUSA) mapInst.current.fitBounds([[24, -125], [50, -66]]);
    else if (isEurope) mapInst.current.fitBounds([[35, -12], [70, 42]]);
    else mapInst.current.fitBounds([[49.0, -11.0], [58.8, 2.5]]);
    L.tileLayer(lightMode ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}" : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 14, subdomains: "abcd" }).addTo(mapInst.current);
    layerRef.current = L.layerGroup().addTo(mapInst.current);
    strikesRef.current = L.layerGroup().addTo(mapInst.current);
    return () => { try { if (mapInst.current) { const m = mapInst.current; mapInst.current = null; layerRef.current = null; strikesRef.current = null; setTimeout(() => { try { m.remove(); } catch (_) {} }, 300); } } catch (_) {} };
  }, [ready]); // eslint-disable-line
  useEffect(() => {
    if (!ready || !mapInst.current || !layerRef.current) return;
    const L = window.L;
    const blobs = preBuiltBlobs ?? buildRiskBlobs(regionData, typeColors, regionDefs);
    drawBlobsOnLayer(L, layerRef.current, blobs, regionData, typeColors);
  }, [ready, regionData, typeColors]); // eslint-disable-line
  useEffect(() => {
    if (!ready || !strikesRef.current) return;
    const L = window.L; strikesRef.current.clearLayers();
    if (!showLightning || !lightningStrikes.length) return;
    const now = Date.now();
    lightningStrikes.forEach(s => {
      const ageMs = now - s.ts, dayMs = 24 * 60 * 60 * 1000, alpha = Math.max(0.15, 1 - (ageMs / dayMs) * 0.85);
      const ageS = ageMs / 1000, size = ageS < 60 ? 10 : ageS < 600 ? 8 : 6, half = size / 2, thick = Math.max(1.5, size * 0.2);
      const html = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="opacity:${alpha}"><rect x="${half - thick / 2}" y="0" width="${thick}" height="${size}" rx="0.5" fill="#000"/><rect x="0" y="${half - thick / 2}" width="${size}" height="${thick}" rx="0.5" fill="#000"/></svg>`;
      L.divIcon && L.marker([s.lat, s.lon], { icon: L.divIcon({ html, iconAnchor: [half, half], className: "" }), interactive: false }).addTo(strikesRef.current);
    });
  }, [ready, lightningStrikes, showLightning]);
  useEffect(() => {
    if (!ready || !mapInst.current) return;
    const L = window.L;
    const handler = async (e) => {
      const { lat, lng } = e.latlng; setClickInfo({ loading: true });
      let bestName = null, bestDist = Infinity;
      const allRegions = isUSA ? USA_REGIONS : isEurope ? EUROPE_REGIONS : (regionDefs || UK_REGIONS);
      for (const [name, def] of Object.entries(allRegions)) {
        const d = centroidDist(def.centroid, [lat, lng]);
        if (d < bestDist && regionData[name]) { bestDist = d; bestName = name; }
      }
      const rInfo = bestName ? regionData[bestName] : null, risk = rInfo?.risk ?? "No Risk";
      const color = typeColors[RISK_ORDER.indexOf(risk)] ?? "#64748b";
      if (markerRef.current) markerRef.current.remove();
      markerRef.current = L.circleMarker([lat, lng], { radius: 8, color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.95 }).addTo(mapInst.current);
      const placeName = await reverseGeocode(lat, lng);
      const nearbyStrikes = lightningStrikes.filter(s => centroidDist([s.lat, s.lon], [lat, lng]) < 0.5).length;
      setClickInfo({ lat, lng, placeName, region: bestName, risk, color, rInfo, nearbyStrikes });
    };
    mapInst.current.off("click"); mapInst.current.on("click", handler);
  }, [ready, regionData, lightningStrikes]); // eslint-disable-line
  const guideText = clickInfo && !clickInfo.loading && activeTypObj ? activeTypObj.guide[RISK_ORDER.indexOf(clickInfo.risk)] ?? "" : "";
  const mapBg = lightMode ? "#e8edf5" : "#060d1e";
  const fsStyle = fullscreen ? { position: "fixed", inset: 0, zIndex: 9999, background: lightMode ? "#dce4ef" : "#060d1e", display: "flex", flexDirection: "column" } : {};
  return (
    <div style={{ position: "relative", ...fsStyle }}>
      <button onClick={() => setFullscreen(v => !v)} title={fullscreen ? "Exit fullscreen" : "Fullscreen map"} style={{ position: "absolute", top: 10, right: 10, zIndex: 1002, display: "flex", alignItems: "center", gap: 4, padding: "5px 8px", borderRadius: 8, background: "rgba(0,0,0,0.65)", border: "1px solid rgba(255,255,255,0.15)", color: "#e2e8f0", fontSize: "0.7rem", cursor: "pointer" }}>
        {fullscreen ? <>{SVG.x("#e2e8f0")} Exit</> : <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg> Full</>}
      </button>
      {showLightning && lightningStrikes.length > 0 && (
        <div style={{ position: "absolute", bottom: 8, right: 10, zIndex: 1001, padding: "4px 8px", borderRadius: 8, background: "rgba(0,0,0,0.72)", border: "1px solid rgba(0,0,0,0.5)", display: "flex", alignItems: "center", gap: 5 }}>
          <svg width="9" height="9" viewBox="0 0 9 9"><rect x="3.5" y="0" width="2" height="9" fill="#000" /><rect x="0" y="3.5" width="9" height="2" fill="#000" /></svg>
          <span style={{ fontSize: "0.58rem", color: "#e2e8f0", fontWeight: 700 }}>{lightningStrikes.length} strikes today</span>
        </div>
      )}
      <div ref={mapRef} style={{ width: "100%", height: fullscreen ? "100%" : 300, borderRadius: fullscreen ? 0 : 14, overflow: "hidden", background: mapBg, flex: fullscreen ? 1 : undefined }} />
      <div style={{ position: "absolute", bottom: 8, left: 10, zIndex: 1000, padding: "3px 8px", borderRadius: 8, background: "rgba(0,0,0,0.6)", pointerEvents: "none" }}>
        <span style={{ fontSize: "0.6rem", color: "#94a3b8" }}>Click map for local risk</span>
      </div>
      {clickInfo && (
        <div style={{ position: "absolute", top: 44, right: 10, zIndex: 1001, padding: "11px 14px", borderRadius: 12, background: "rgba(8,15,35,0.97)", border: `1px solid ${clickInfo.loading ? "#334155" : clickInfo.color}44`, backdropFilter: "blur(10px)", minWidth: 190, maxWidth: 245 }}>
          {clickInfo.loading ? (<span style={{ fontSize: "0.72rem", color: "#64748b" }}>Locating…</span>) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: clickInfo.color, flexShrink: 0 }} /><span style={{ fontSize: "0.78rem", fontWeight: 700, color: clickInfo.color }}>{clickInfo.risk}</span><span style={{ marginLeft: "auto", fontSize: "0.62rem", color: "#475569" }}>{activeTypObj?.label}</span></div>
              <p style={{ margin: "0 0 1px", fontSize: "0.74rem", color: "#e2e8f0", fontWeight: 700 }}>{clickInfo.placeName}</p>
              {clickInfo.region && <p style={{ margin: "0 0 5px", fontSize: "0.62rem", color: "#64748b" }}>{clickInfo.region}</p>}
              {guideText && <p style={{ margin: "0 0 7px", fontSize: "0.64rem", color: "#94a3b8", lineHeight: 1.5 }}>{guideText}</p>}
              {clickInfo.rInfo && (
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 7, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 10px", fontSize: "0.62rem", color: "#94a3b8" }}>
                  <span>CAPE: <b style={{ color: "#e2e8f0" }}>{Math.round(clickInfo.rInfo.capeMax)}</b></span>
                  <span>LI: <b style={{ color: "#e2e8f0" }}>{clickInfo.rInfo.liMin?.toFixed(1)}</b></span>
                  <span>RH: <b style={{ color: "#e2e8f0" }}>{Math.round(clickInfo.rInfo.rhAvg)}%</b></span>
                  <span>Gust: <b style={{ color: "#e2e8f0" }}>{clickInfo.rInfo.windGust}mph</b></span>
                  {clickInfo.nearbyStrikes > 0 && (<span style={{ gridColumn: "span 2", color: "#000", fontWeight: 700 }}>✚ {clickInfo.nearbyStrikes} nearby strikes</span>)}
                </div>
              )}
              <button onClick={() => { setClickInfo(null); if (markerRef.current) markerRef.current.remove(); }} style={{ marginTop: 4, fontSize: "0.6rem", color: "#334155", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 3 }}>{SVG.x("#334155")} Dismiss</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── LIGHTNING VERIFICATION MAP ─────────────────────────────────────────────────
function LightningVerificationMap({ dayForecast, typeObj, lightningStrikes, wsStatus, lightMode = false }) {
  const [showStrikes, setShowStrikes] = useState(true);
  const strikeCount = lightningStrikes.length;
  const lsColor = wsStatus === "live" ? "#22c55e" : wsStatus === "error" ? "#f87171" : "#f59e0b";
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, background: `${lsColor}12`, border: `1px solid ${lsColor}44` }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: lsColor, flexShrink: 0, animation: wsStatus === "live" ? "tcmPulse 2s infinite" : "none" }} />
          <span style={{ fontSize: "0.65rem", fontWeight: 700, color: lsColor }}>{wsStatus === "live" ? "BLITZORTUNG LIVE" : wsStatus === "connecting" ? "CONNECTING…" : "OFFLINE"}</span>
        </div>
        <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#e2e8f0" }}>Lightning Verification — Today</span>
        {strikeCount > 0 && <span style={{ fontSize: "0.65rem", color: "#94a3b8" }}>{strikeCount} strikes today</span>}
        <button onClick={() => setShowStrikes(v => !v)} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8, fontSize: "0.68rem", fontWeight: 600, cursor: "pointer", border: `1.5px solid ${showStrikes ? "#000" : "rgba(255,255,255,0.1)"}`, background: showStrikes ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.03)", color: showStrikes ? "#e2e8f0" : "#64748b", transition: "all 0.2s" }}>
          <svg width="9" height="9" viewBox="0 0 9 9"><rect x="3.5" y="0" width="2" height="9" fill={showStrikes ? "#000" : "#64748b"} /><rect x="0" y="3.5" width="9" height="2" fill={showStrikes ? "#000" : "#64748b"} /></svg>
          Strike overlay {showStrikes ? "ON" : "OFF"}
        </button>
      </div>
      <div style={{ marginBottom: 8, padding: "8px 12px", borderRadius: 10, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)", fontSize: "0.68rem", color: "#94a3b8", lineHeight: 1.6 }}>
        Black <b style={{ color: "#e2e8f0" }}>+</b> markers show Blitzortung real-time lightning strikes accumulated since midnight over the UK, Ireland &amp; Northern France.
      </div>
      {dayForecast && (<RiskMap regionData={dayForecast.regions} typeColors={typeObj.colors} activeTypObj={typeObj} preBuiltBlobs={dayForecast.preBuiltBlobs} lightMode={lightMode} regionDefs={UK_REGIONS} lightningStrikes={lightningStrikes} showLightning={showStrikes} mapId="lightning-verification" key={`lv-${typeObj.id}-${lightMode}`} />)}
      {strikeCount > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {Object.entries(UK_REGIONS).map(([name, def]) => {
            const poly = def.polygon; if (!poly?.length) return null;
            const minLat = Math.min(...poly.map(p => p[0])) - 0.3, maxLat = Math.max(...poly.map(p => p[0])) + 0.3;
            const minLon = Math.min(...poly.map(p => p[1])) - 0.5, maxLon = Math.max(...poly.map(p => p[1])) + 0.5;
            const count = lightningStrikes.filter(s => s.lat >= minLat && s.lat <= maxLat && s.lon >= minLon && s.lon <= maxLon).length;
            if (count === 0) return null;
            const c = count >= 20 ? "#ef4444" : count >= 8 ? "#f97316" : count >= 3 ? "#facc15" : "#94a3b8";
            return (
              <div key={name} style={{ padding: "4px 9px", borderRadius: 8, background: `${c}10`, border: `1px solid ${c}30`, display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="8" height="8" viewBox="0 0 8 8"><rect x="3" y="0" width="2" height="8" fill="#000" /><rect x="0" y="3" width="8" height="2" fill="#000" /></svg>
                <span style={{ fontSize: "0.65rem", color: "#e2e8f0" }}>{name}</span>
                <span style={{ fontSize: "0.65rem", fontWeight: 700, color: c }}>{count}</span>
              </div>
            );
          }).filter(Boolean)}
        </div>
      )}
    </div>
  );
}

// ── HOURLY PLAYBACK MODAL ─────────────────────────────────────────────────────
function HourlyPlaybackModal({ forecasts, activeType, onClose }) {
  const allHours = [];
  const typeObj = RISK_TYPES.find(t => t.id === activeType) ?? RISK_TYPES[0];
  if (forecasts) {
    const typedForecasts = forecasts[activeType] ?? [];
    typedForecasts.forEach((dayFc) => {
      const hours = Object.values(dayFc.regions)[0]?.hourlyData ?? [];
      for (let h = 0; h < Math.min(24, hours.length); h++) {
        const regionHourly = {};
        for (const [name, rd] of Object.entries(dayFc.regions)) {
          const hd = rd.hourlyData?.[h]; if (!hd) continue;
          regionHourly[name] = { ...rd, capeMax: hd.cape, capeAvg: hd.cape * 0.7, liMin: hd.li, rhAvg: hd.rh, ppMax: hd.pp, gustMax: hd.gust, risk: scoreRisk({ capeMax: hd.cape, capeAvg: hd.cape * 0.7, liMin: hd.li, rhAvg: hd.rh, ppMax: hd.pp, gustMax: hd.gust }, activeType, 1.0), windGust: Math.round(hd.gust * 2.237) };
        }
        allHours.push({ h, label: `${dayFc.dayLabel} ${String(h).padStart(2, "0")}:00`, date: dayFc.date, regions: regionHourly });
      }
    });
  }
  const nowHour = new Date().getHours(), startIdx = Math.max(0, allHours.findIndex(f => f.h >= nowHour));
  const [currentIdx, setCurrentIdx] = useState(startIdx), [playing, setPlaying] = useState(false), intervalRef = useRef(null);
  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setCurrentIdx(prev => { if (prev >= allHours.length - 1) { setPlaying(false); return prev; } return prev + 1; });
      }, 600);
    } else { clearInterval(intervalRef.current); }
    return () => clearInterval(intervalRef.current);
  }, [playing, allHours.length]);
  const frame = allHours[currentIdx], blobs = frame ? buildRiskBlobs(frame.regions, typeObj.colors, UK_REGIONS) : null;
  const overallRisks = frame ? Object.values(frame.regions).map(r => RISK_ORDER.indexOf(r.risk)) : [0];
  const maxRiskIdx = Math.max(...overallRisks), overallRisk = RISK_ORDER[maxRiskIdx] ?? "No Risk", topColor = typeObj.colors[maxRiskIdx] ?? "#64748b";
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 720, maxHeight: "92vh", overflowY: "auto", borderRadius: 22, background: "linear-gradient(160deg,#0d1829,#1a1040)", border: "1px solid rgba(167,139,250,0.2)", boxShadow: "0 40px 80px rgba(0,0,0,0.6)" }}>
        <div style={{ height: 3, background: `linear-gradient(90deg,${topColor},${topColor}88,transparent)` }} />
        <div style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>{SVG.clock("#a78bfa")}<span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#a78bfa" }}>Hourly Playback · UK+Ireland · {typeObj.label}</span></div>
              <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#f1f5f9" }}>{frame?.label ?? "—"}</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: topColor }} /><span style={{ fontSize: "0.8rem", fontWeight: 700, color: topColor }}>{overallRisk}</span></div>
            </div>
            <button onClick={onClose} style={{ padding: "6px 10px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: "0.72rem" }}>{SVG.x("#94a3b8")} Close</button>
          </div>
          {frame && blobs && (<div style={{ marginBottom: 14 }}><RiskMap regionData={frame.regions} typeColors={typeObj.colors} activeTypObj={typeObj} preBuiltBlobs={blobs} regionDefs={UK_REGIONS} key={`hourly-${currentIdx}`} /></div>)}
          <div style={{ marginBottom: 14 }}>
            <input type="range" min={0} max={allHours.length - 1} value={currentIdx} onChange={e => { setPlaying(false); setCurrentIdx(Number(e.target.value)); }} style={{ width: "100%", marginBottom: 8, accentColor: topColor }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => { setPlaying(false); setCurrentIdx(Math.max(0, currentIdx - 1)); }} style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8", cursor: "pointer", fontSize: "0.72rem" }}>←</button>
                <button onClick={() => setPlaying(v => !v)} style={{ padding: "6px 16px", borderRadius: 8, background: playing ? "rgba(167,139,250,0.2)" : "rgba(139,92,246,0.25)", border: `1px solid ${playing ? "rgba(167,139,250,0.4)" : "rgba(139,92,246,0.5)"}`, color: "#a78bfa", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem", fontWeight: 700 }}>
                  {playing ? SVG.pause("#a78bfa") : SVG.play("#a78bfa")} {playing ? "Pause" : "Play"}
                </button>
                <button onClick={() => { setPlaying(false); setCurrentIdx(Math.min(allHours.length - 1, currentIdx + 1)); }} style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8", cursor: "pointer", fontSize: "0.72rem" }}>→</button>
              </div>
              <span style={{ fontSize: "0.62rem", color: "#475569" }}>{currentIdx + 1}/{allHours.length}</span>
            </div>
          </div>
          {frame && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {Object.entries(frame.regions).filter(([, r]) => r.risk !== "No Risk").sort((a, b) => RISK_ORDER.indexOf(b[1].risk) - RISK_ORDER.indexOf(a[1].risk)).map(([name, r]) => {
                const c = typeObj.colors[RISK_ORDER.indexOf(r.risk)] ?? "#64748b";
                return (<div key={name} style={{ padding: "5px 10px", borderRadius: 8, background: `${c}12`, border: `1px solid ${c}30`, display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: c, flexShrink: 0 }} /><span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#e2e8f0" }}>{name}</span><span style={{ fontSize: "0.68rem", fontWeight: 700, color: c }}>{r.risk}</span></div>);
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── REGIONAL BREAKDOWN ────────────────────────────────────────────────────────
function RegionalBreakdown({ regions, typeColors, lightMode = false }) {
  const [open, setOpen] = useState(false);
  const lm = (l, d) => lightMode ? l : d;
  const active = Object.entries(regions).filter(([, d]) => d.risk !== "No Risk").sort((a, b) => RISK_ORDER.indexOf(b[1].risk) - RISK_ORDER.indexOf(a[1].risk));
  if (!active.length) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <button onClick={() => setOpen(v => !v)} style={{ width: "100%", padding: "8px 12px", borderRadius: 10, background: lm("rgba(0,0,0,0.04)", "rgba(255,255,255,0.04)"), border: `1px solid ${lm("rgba(0,0,0,0.08)", "rgba(255,255,255,0.08)")}`, color: lm("#475569", "#64748b"), fontSize: "0.72rem", fontWeight: 600, cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Regional breakdown ({active.length} areas with risk)</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {active.map(([name, d]) => {
            const color = typeColors[RISK_ORDER.indexOf(d.risk)] ?? "#64748b", hasLightning = d.lightningBoost > 0;
            return (
              <div key={name} style={{ padding: "6px 12px", borderRadius: 10, background: `${color}0a`, border: `1px solid ${color}30`, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <span style={{ fontSize: "0.74rem", fontWeight: 700, color: lm("#0f172a", "#e2e8f0") }}>{name}</span>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, color }}>{d.risk}</span>
                {hasLightning && (<span title={`+${d.lightningBoost} from live lightning`}><svg width="9" height="9" viewBox="0 0 9 9"><rect x="3" y="0" width="2" height="9" fill="#000" /><rect x="0" y="3" width="9" height="2" fill="#000" /></svg></span>)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── RISK EDIT MODAL ───────────────────────────────────────────────────────────
function RiskEditModal({ forecast, currentOverride, onSave, onClose }) {
  const [overallRisk, setOverallRisk] = useState(currentOverride?.overallRisk ?? forecast.overallRisk);
  const [minRisk, setMinRisk] = useState(currentOverride?.minRisk ?? forecast.minRisk);
  const [maxRisk, setMaxRisk] = useState(currentOverride?.maxRisk ?? forecast.maxRisk);
  const typeObj = RISK_TYPES.find(t => t.id === forecast.type) ?? RISK_TYPES[0];
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 9001, width: "92%", maxWidth: 420, background: "linear-gradient(160deg,#0d1829,#1a1040)", border: "1px solid rgba(167,139,250,0.25)", borderRadius: 20, padding: 24 }}>
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 8, width: 28, height: 28, cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>{SVG.x("#64748b")}</button>
        <h3 style={{ margin: "0 0 4px", fontSize: "0.95rem", fontWeight: 700, color: "#f1f5f9" }}>Edit Risk — {forecast.formattedDate}</h3>
        <p style={{ margin: "0 0 20px", fontSize: "0.7rem", color: "#64748b" }}>{typeObj.label} override</p>
        {[["Overall Risk", overallRisk, setOverallRisk], ["Min Risk", minRisk, setMinRisk], ["Max Risk", maxRisk, setMaxRisk]].map(([label, val, setter]) => (
          <div key={label} style={{ marginBottom: 16 }}>
            <p style={{ margin: "0 0 8px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {RISK_ORDER.map((rv, i) => { const c = typeObj.colors[i] ?? "#64748b", active = val === rv; return (<button key={rv} onClick={() => setter(rv)} style={{ padding: "5px 12px", borderRadius: 20, fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", border: `1.5px solid ${active ? c : "rgba(255,255,255,0.1)"}`, background: active ? `${c}30` : "transparent", color: active ? c : "#64748b", transition: "all 0.15s" }}>{rv}</button>); })}
            </div>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#64748b", fontSize: "0.8rem", cursor: "pointer" }}>Cancel</button>
          <button onClick={() => { onSave({ overallRisk, minRisk, maxRisk }); onClose(); }} style={{ flex: 2, padding: "10px 0", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}>Save Override</button>
          {currentOverride && (<button onClick={() => { onSave(null); onClose(); }} style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: "0.8rem", cursor: "pointer" }}>Reset</button>)}
        </div>
      </div>
    </>
  );
}

// ── COUNTDOWN HELPERS ─────────────────────────────────────────────────────────
function NextUpdateCountdown({ lightMode }) {
  const [remaining, setRemaining] = useState(msUntilNextSlot());
  useEffect(() => { const iv = setInterval(() => setRemaining(msUntilNextSlot()), 1000); return () => clearInterval(iv); }, []);
  const h = Math.floor(remaining / 3600000), m = Math.floor((remaining % 3600000) / 60000), s = Math.floor((remaining % 60000) / 1000);
  const fmt = v => String(v).padStart(2, "0");
  const fg4 = lightMode ? "#64748b" : "#475569";
  return (<span style={{ fontSize: "0.62rem", color: fg4, display: "flex", alignItems: "center", gap: 4 }}>{SVG.clock(fg4)}Next model update in {h > 0 ? `${h}h ` : ""}{fmt(m)}m {fmt(s)}s</span>);
}

function AutoAdjustCountdown({ lastAdjusted, lightMode }) {
  const [secondsAgo, setSecondsAgo] = useState(0), [nextIn, setNextIn] = useState(1200);
  useEffect(() => { const iv = setInterval(() => { const elapsed = Math.round((Date.now() - lastAdjusted) / 1000); setSecondsAgo(elapsed); setNextIn(Math.max(0, 1200 - elapsed)); }, 1000); return () => clearInterval(iv); }, [lastAdjusted]);
  const fmt = v => String(v).padStart(2, "0"), m = Math.floor(nextIn / 60), s = nextIn % 60;
  const fg4 = lightMode ? "#64748b" : "#475569";
  const adj = secondsAgo < 10 ? "just now" : secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.round(secondsAgo / 60)}m ago`;
  return (<span style={{ fontSize: "0.62rem", color: fg4, display: "flex", alignItems: "center", gap: 4 }}><svg width="9" height="9" viewBox="0 0 9 9"><rect x="3" y="0" width="2" height="9" fill={fg4} /><rect x="0" y="3" width="9" height="2" fill={fg4} /></svg>Risk adjusted {adj} · next in {fmt(m)}:{fmt(s)}</span>);
}

function DataSourceStatus({ tomorrowStatus, omStatus, lightMode }) {
  const fg4 = lightMode ? "#64748b" : "#475569";
  const statusColor = s => s === "ok" ? "#22c55e" : s === "partial" ? "#f59e0b" : s === "error" ? "#ef4444" : "#64748b";
  const statusLabel = s => s === "ok" ? "OK" : s === "partial" ? "Partial" : s === "error" ? "Error" : "—";
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
      <span style={{ fontSize: "0.6rem", color: fg4, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor(tomorrowStatus) }} /> Tomorrow.io: <b style={{ color: statusColor(tomorrowStatus) }}>{statusLabel(tomorrowStatus)}</b></span>
      <span style={{ fontSize: "0.6rem", color: fg4, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor(omStatus) }} /> Open-Meteo Ensemble: <b style={{ color: statusColor(omStatus) }}>{statusLabel(omStatus)}</b></span>
    </div>
  );
}

// ── FORECAST DESCRIPTION ──────────────────────────────────────────────────────
function ForecastDescription({ forecast, dayOffset, activeType, isAdmin, lightMode, lightningCount = 0, wsStatus = "connecting", slotKey }) {
  const typeObj = RISK_TYPES.find(t => t.id === activeType) ?? RISK_TYPES[0];
  const [saved, setSaved] = useState(() => loadDesc(slotKey, activeType, dayOffset));
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [editOverall, setEditOverall] = useState("No Risk");
  const [editMin, setEditMin] = useState("No Risk");
  const [editMax, setEditMax] = useState("No Risk");

  const effectiveOverall = saved?.overallRisk ?? forecast?.overallRisk ?? "No Risk";
  const effectiveMin     = saved?.minRisk     ?? forecast?.minRisk     ?? "No Risk";
  const effectiveMax     = saved?.maxRisk     ?? forecast?.maxRisk     ?? "No Risk";
  const displayText      = saved?.text        ?? null;
  const topColor         = typeObj.colors[RISK_ORDER.indexOf(effectiveOverall)] ?? "#64748b";
  const lm               = (l, d) => lightMode ? l : d;

  useEffect(() => {
    if (!forecast) return;
    const existing = loadDesc(slotKey, activeType, dayOffset);
    if (existing?.text) { setSaved(existing); return; }
    setGenerating(true);
    const regionLines = Object.entries(forecast.regions || {})
      .filter(([, d]) => d.risk !== "No Risk")
      .sort((a, b) => RISK_ORDER.indexOf(b[1].risk) - RISK_ORDER.indexOf(a[1].risk))
      .slice(0, 14)
      .map(([n, d]) => `${n}: ${d.risk} (CAPE ${Math.round(d.capeMax)} J/kg, LI ${d.liMin?.toFixed(1)}, RH ${Math.round(d.rhAvg)}%${d.lightningBoost > 0 ? `, lightning-boosted` : ""})`)
      .join("\n");
    const lightningNote = lightningCount > 0 && wsStatus === "live" && dayOffset === 0
      ? `\n${lightningCount} live Blitzortung strikes recorded today over the UK/Ireland domain, confirming active convection in affected areas.` : "";
    const dayLabel = dayOffset === 0 ? "Today" : dayOffset === 1 ? "Tomorrow" : `${forecast.formattedDate}`;
    const prompt = `You are a senior operational meteorologist producing public-facing severe weather outlook text for TCM (Thunderstorm Convective Monitoring) UK & Ireland. Write a precise, authoritative forecast description for ${typeObj.label} risk for ${dayLabel}.\n\nWrite EXACTLY 3–4 flowing sentences as ONE paragraph. No bullet points. No headers. No preamble. Start directly with the forecast content. Be specific about which regions face the greatest risk, timing of peak activity, atmospheric drivers (CAPE, instability, moisture), and potential impacts. Use professional meteorological language appropriate for a public severe weather service. Calibrate language to the risk level — do not sensationalise low-risk days, do not understate high-risk days.\n\nDate: ${dayLabel}\nOverall risk: ${forecast.overallRisk}\nPeak CAPE: ${forecast.avgCape} J/kg | Mean RH: ${forecast.avgRH}%${lightningNote}\n\nRisk areas by severity:\n${regionLines || "All regions: No Risk — conditions are stable."}\n\nWrite only the forecast paragraph now, nothing else:`;
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
    })
      .then(r => r.json())
      .then(data => {
        const text = data.content?.map(c => c.text || "").join("").trim() ?? "";
        if (text) {
          const entry = { text, overallRisk: forecast.overallRisk, minRisk: forecast.minRisk, maxRisk: forecast.maxRisk, generatedAt: Date.now() };
          saveDesc(slotKey, activeType, dayOffset, entry);
          setSaved(entry);
        }
        setGenerating(false);
      })
      .catch(() => setGenerating(false));
  }, [slotKey, activeType, dayOffset]); // eslint-disable-line

  const openEdit = () => { setEditText(saved?.text ?? ""); setEditOverall(effectiveOverall); setEditMin(effectiveMin); setEditMax(effectiveMax); setEditing(true); };
  const saveEdit = () => {
    const entry = { text: editText, overallRisk: editOverall, minRisk: editMin, maxRisk: editMax, generatedAt: saved?.generatedAt ?? Date.now(), editedAt: Date.now() };
    saveDesc(slotKey, activeType, dayOffset, entry); setSaved(entry); setEditing(false);
  };
  const regenerate = () => { try { localStorage.removeItem(descStorageKey(slotKey, activeType, dayOffset)); } catch {} setSaved(null); };
  const isSevere = effectiveOverall === "Severe";
  const editedColor = typeObj.colors[RISK_ORDER.indexOf(editOverall)] ?? "#64748b";

  return (
    <>
      <div style={{ padding: "16px 18px", borderRadius: 14, background: isSevere ? "rgba(0,0,0,0.45)" : lm("rgba(0,0,0,0.03)", "rgba(255,255,255,0.04)"), border: isSevere ? "2px solid #000" : `1px solid ${topColor}28`, marginBottom: 16, position: "relative" }}>
        {isSevere && (<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "6px 12px", borderRadius: 8, background: "repeating-linear-gradient(45deg, #111 0px, #111 6px, #222 6px, #222 12px)", border: "1.5px solid #000" }}><span style={{ fontSize: "0.72rem", fontWeight: 900, color: "#fff", letterSpacing: "0.15em", textTransform: "uppercase" }}>⚠ SEVERE — CATASTROPHIC THREAT</span></div>)}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 20, background: isSevere ? "rgba(0,0,0,0.7)" : `rgba(${parseInt(topColor.slice(1, 3), 16)},${parseInt(topColor.slice(3, 5), 16)},${parseInt(topColor.slice(5, 7), 16)},0.12)`, border: isSevere ? "2px solid #000" : `1.5px solid ${topColor}55` }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: isSevere ? "#fff" : topColor }} />
            <span style={{ fontSize: "0.78rem", fontWeight: 800, color: isSevere ? "#fff" : topColor }}>{effectiveOverall}</span>
          </div>
          {effectiveMin !== effectiveMax && (<span style={{ fontSize: "0.65rem", color: lm("#475569", "#64748b") }}>Range: <b style={{ color: lm("#1e293b", "#e2e8f0") }}>{effectiveMin}</b> – <b style={{ color: lm("#1e293b", "#e2e8f0") }}>{effectiveMax}</b></span>)}
          {isAdmin && (
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button onClick={openEdit} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 8, background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.3)", color: "#a78bfa", fontSize: "0.65rem", fontWeight: 700, cursor: "pointer" }}>{SVG.edit("#a78bfa")} Edit</button>
              <button onClick={regenerate} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#64748b", fontSize: "0.65rem", cursor: "pointer" }}>{SVG.refresh("#64748b")}</button>
            </div>
          )}
        </div>
        {generating ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 6, height: 6, borderRadius: "50%", background: topColor, animation: "tcmPulse 1.4s infinite" }} /><span style={{ fontSize: "0.78rem", color: lm("#475569", "#64748b"), fontStyle: "italic" }}>Preparing forecast…</span></div>
        ) : displayText ? (
          <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.85, color: isSevere ? "#f8fafc" : lm("#1e293b", "#e2e8f0"), fontWeight: 400 }}>{displayText}</p>
        ) : (
          <p style={{ margin: 0, fontSize: "0.78rem", color: lm("#475569", "#94a3b8"), fontStyle: "italic" }}>No forecast text available.</p>
        )}
        {isAdmin && saved?.editedAt && (<p style={{ margin: "8px 0 0", fontSize: "0.58rem", color: lm("#94a3b8", "#475569") }}>Edited {new Date(saved.editedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })} BST · Resets at next model cycle</p>)}
      </div>
      {editing && (
        <>
          <div onClick={() => setEditing(false)} style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)" }} />
          <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 9501, width: "94%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", background: "linear-gradient(160deg,#0d1829,#1a1040)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 22, padding: 26 }}>
            <div style={{ height: 3, background: `linear-gradient(90deg,${editedColor},${editedColor}66,transparent)`, borderRadius: 2, marginBottom: 20 }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div><h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#f1f5f9" }}>Edit Forecast</h3><p style={{ margin: "3px 0 0", fontSize: "0.68rem", color: "#64748b" }}>{typeObj.label} · {forecast?.formattedDate} · Changes visible to all users</p></div>
              <button onClick={() => setEditing(false)} style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 8, width: 28, height: 28, cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>{SVG.x("#64748b")}</button>
            </div>
            <div style={{ marginBottom: 20 }}>
              <p style={{ margin: "0 0 8px", fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Forecast Text</p>
              <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={6} style={{ width: "100%", padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0", fontSize: "0.82rem", lineHeight: 1.8, resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} placeholder="Enter forecast description…" />
            </div>
            {[["Overall Risk", editOverall, setEditOverall], ["Lowest Risk", editMin, setEditMin], ["Highest Risk", editMax, setEditMax]].map(([label, val, setter]) => (
              <div key={label} style={{ marginBottom: 16 }}>
                <p style={{ margin: "0 0 8px", fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {RISK_ORDER.map((rv, i) => { const c = typeObj.colors[i] ?? "#64748b", isAct = val === rv; return <button key={rv} onClick={() => setter(rv)} style={{ padding: "5px 13px", borderRadius: 20, fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", border: `1.5px solid ${isAct ? c : "rgba(255,255,255,0.1)"}`, background: isAct ? `${c}30` : "transparent", color: isAct ? c : "#64748b", transition: "all 0.15s" }}>{rv}</button>; })}
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
              <button onClick={() => setEditing(false)} style={{ flex: 1, padding: "11px 0", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#64748b", fontSize: "0.8rem", cursor: "pointer" }}>Cancel</button>
              <button onClick={saveEdit} style={{ flex: 2, padding: "11px 0", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", fontSize: "0.82rem", fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>{SVG.check("#fff")} Save & Publish</button>
            </div>
            <p style={{ margin: "12px 0 0", fontSize: "0.6rem", color: "#334155", textAlign: "center" }}>Saved to local storage · Resets automatically at next 6-hour model cycle</p>
          </div>
        </>
      )}
    </>
  );
}

// ── REALTIME HELPERS ──────────────────────────────────────────────────────────
function buildRealtimeRegions(dayForecast, lightningStrikes, typeId, regionDefs) {
  if (!dayForecast?.regions) return null;
  const regions = {};
  for (const [name, base] of Object.entries(dayForecast.regions)) {
    const def = regionDefs[name], boost = computeLightningBoost(lightningStrikes, def), rtBoost = boost * 2.0;
    regions[name] = { ...base, risk: scoreRisk(base, typeId, 1.0, rtBoost), lightningBoost: rtBoost, realtimeMode: true };
  }
  return regions;
}

// ── SEVERE KEY ICON ───────────────────────────────────────────────────────────
function SevereKeyIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ display: "block", flexShrink: 0 }}>
      <defs><pattern id="key-hatch" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45 0 0)"><line x1="0" y1="0" x2="0" y2="4" stroke="#111" strokeWidth="2" /></pattern></defs>
      <rect x="0" y="0" width="14" height="14" rx="2" fill="#111111" />
      <rect x="0" y="0" width="14" height="14" rx="2" fill="url(#key-hatch)" fillOpacity="0.55" />
      <rect x="0" y="0" width="14" height="14" rx="2" fill="none" stroke="#000" strokeWidth="1.5" />
    </svg>
  );
}

// ── AVAILABILITY BANNER ───────────────────────────────────────────────────────
/**
 * Shown to all users when the admin has toggled outlooks as unavailable.
 * Replaces the entire forecast card area.
 */
function UnavailableBanner({ lightMode }) {
  const lm = (l, d) => lightMode ? l : d;
  return (
    <div style={{
      borderRadius: 22,
      overflow: "hidden",
      background: lm(
        "linear-gradient(160deg,rgba(241,245,249,0.97),rgba(226,232,240,0.99))",
        "linear-gradient(160deg,rgba(10,18,38,0.92),rgba(6,13,30,0.96))"
      ),
      border: `1px solid ${lm("rgba(0,0,0,0.1)", "rgba(255,255,255,0.08)")}`,
    }}>
      <div style={{ height: 4, background: "linear-gradient(90deg,#f59e0b,#f59e0baa,transparent)" }} />
      <div style={{ padding: "48px 32px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: lm("rgba(245,158,11,0.1)", "rgba(245,158,11,0.12)"), border: "1px solid rgba(245,158,11,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {SVG.warning("#f59e0b", 26)}
        </div>
        <div>
          <h2 style={{ margin: "0 0 8px", fontSize: "1.1rem", fontWeight: 700, color: lm("#1e293b", "#f1f5f9") }}>
            Outlooks Currently Unavailable
          </h2>
          <p style={{ margin: 0, fontSize: "0.88rem", color: lm("#475569", "#94a3b8"), lineHeight: 1.7, maxWidth: 400 }}>
            Our severe weather outlooks are temporarily unavailable due to a data issue. Please check back tomorrow for updated forecasts.
          </p>
        </div>
        <div style={{ marginTop: 8, padding: "10px 20px", borderRadius: 12, background: lm("rgba(245,158,11,0.07)", "rgba(245,158,11,0.08)"), border: "1px solid rgba(245,158,11,0.2)" }}>
          <span style={{ fontSize: "0.72rem", color: lm("#92400e", "#fbbf24"), fontWeight: 600 }}>
            We apologise for the inconvenience. Outlooks will resume as soon as data is restored.
          </span>
        </div>
      </div>
    </div>
  );
}

// ── ADMIN AVAILABILITY TOGGLE ─────────────────────────────────────────────────
/**
 * Inline toggle rendered in the header — only visible when isAdmin === true.
 * Shows current status and a single button to flip it.
 */
function AvailabilityToggle({ available, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", borderRadius: 10, background: available ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.1)", border: `1px solid ${available ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}` }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: available ? "#22c55e" : "#ef4444", flexShrink: 0 }} />
      <span style={{ fontSize: "0.65rem", fontWeight: 700, color: available ? "#22c55e" : "#f87171" }}>
        {available ? "OUTLOOKS ON" : "OUTLOOKS OFF"}
      </span>
      <button
        onClick={() => onChange(!available)}
        style={{
          marginLeft: 4,
          padding: "3px 9px",
          borderRadius: 7,
          fontSize: "0.62rem",
          fontWeight: 700,
          cursor: "pointer",
          border: `1px solid ${available ? "rgba(239,68,68,0.4)" : "rgba(34,197,94,0.4)"}`,
          background: available ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)",
          color: available ? "#f87171" : "#4ade80",
          transition: "all 0.2s",
        }}
        title={available ? "Disable outlooks for all users" : "Re-enable outlooks for all users"}
      >
        {available ? "Disable" : "Enable"}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── MAIN COMPONENT ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
export default function ThunderstormMonitor({ isAdmin = false, lightMode = false, isEurope = false, isUSA = false }) {
  const regionKey = isUSA ? "usa" : isEurope ? "eu" : "uk";

  // ── Core state ──────────────────────────────────────────────────────────────
  const [activeDay,  setActiveDay]  = useState(0);
  const [activeType, setActiveType] = useState("thunderstorm");
  const [forecasts,  setForecasts]  = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [showHourly, setShowHourly] = useState(false);
  const [overrides,  setOverrides]  = useState({});
  const [editingDay, setEditingDay] = useState(null);
  const [riskMode,   setRiskMode]   = useState("day");

  // ── AVAILABILITY STATE ──────────────────────────────────────────────────────
  // Persists to localStorage so the setting survives page reloads.
  // Only the admin UI can change this; all users read it.
  const [outlookAvailable, setOutlookAvailable] = useState(loadAvailability);
  const handleAvailabilityChange = useCallback((val) => {
    setOutlookAvailable(val);
    saveAvailability(val);
  }, []);

  // ── Data source status ──────────────────────────────────────────────────────
  const [tomorrowStatus, setTomorrowStatus] = useState("idle");
  const [omStatus,       setOmStatus]       = useState("idle");

  // ── Lightning ───────────────────────────────────────────────────────────────
  const [lightningStrikes, setLightningStrikes] = useState([]);
  const [wsStatus,         setWsStatus]         = useState("connecting");
  const strikesRef = useRef([]);

  // ── Slot / cache ────────────────────────────────────────────────────────────
  const [slotKey, setSlotKey] = useState(getUkSlotKey());
  const [lastAdjusted, setLastAdjusted] = useState(Date.now());
  const [rawModelData, setRawModelData] = useState(null);
  const autoAdjTimer = useRef(null);
  const cacheKey = `tcm_v8_${regionKey}_${slotKey}`;

  const grid       = isUSA ? USA_GRID    : isEurope ? EUROPE_GRID    : UK_GRID;
  const regionDefs = isUSA ? USA_REGIONS : isEurope ? EUROPE_REGIONS : UK_REGIONS;

  const getWindowMs = () => {
    const now = new Date(), midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight - now;
  };

  // Slot watcher — auto-refresh when the 6h model cycle ticks over
  useEffect(() => {
    const iv = setInterval(() => {
      const newSlot = getUkSlotKey();
      setSlotKey(prev => {
        if (prev !== newSlot) { setTimeout(() => fetchData(true), 1000); return newSlot; }
        return prev;
      });
    }, 60000);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line

  // Blitzortung WebSocket
  useEffect(() => {
    if (isEurope || isUSA) return;
    const strikes = strikesRef.current;
    const prune = () => {
      const cutoff = Date.now() - getWindowMs();
      const before = strikes.length;
      strikes.splice(0, strikes.length, ...strikes.filter(s => s.ts >= cutoff));
      if (strikes.length !== before) setLightningStrikes([...strikes]);
    };
    const stopWs = connectBlitzortung(
      (strike) => {
        const isDup = strikes.some(s => Math.abs(s.ts - strike.time) < 100 && Math.abs(s.lat - strike.lat) < 0.001 && Math.abs(s.lon - strike.lon) < 0.001);
        if (isDup) return;
        strikes.push({ lat: strike.lat, lon: strike.lon, ts: strike.time });
        prune();
        setLightningStrikes([...strikes]);
      },
      setWsStatus
    );
    const pruneIv = setInterval(prune, 30000);
    const msTillMidnight = (() => { const now = new Date(), midnight = new Date(now); midnight.setHours(24, 0, 0, 0); return midnight - now; })();
    const midnightTimer = setTimeout(() => { strikes.splice(0, strikes.length); setLightningStrikes([]); }, msTillMidnight);
    return () => { stopWs(); clearInterval(pruneIv); clearTimeout(midnightTimer); };
  }, [isEurope, isUSA]); // eslint-disable-line

  const applyAdjustment = useCallback((raw, strikes) => {
    if (!raw) return;
    const { omPointResults, tomorrowMap } = raw;
    const rebuilt = buildForecasts(omPointResults, tomorrowMap, regionDefs, isEurope, isUSA, strikes);
    try { localStorage.setItem(cacheKey, JSON.stringify(rebuilt)); } catch {}
    setForecasts(rebuilt);
    setLastAdjusted(Date.now());
  }, [cacheKey, regionDefs, isEurope, isUSA]);

  useEffect(() => {
    if (!rawModelData) return;
    const timer = setTimeout(() => applyAdjustment(rawModelData, lightningStrikes), 2000);
    return () => clearTimeout(timer);
  }, [lightningStrikes.length]); // eslint-disable-line

  useEffect(() => {
    autoAdjTimer.current = setInterval(() => { if (rawModelData) applyAdjustment(rawModelData, lightningStrikes); }, 20 * 60 * 1000);
    return () => clearInterval(autoAdjTimer.current);
  }, [rawModelData, lightningStrikes, applyAdjustment]);

  const fetchData = useCallback((forceRefresh = false) => {
    if (!forceRefresh) {
      try { const cached = localStorage.getItem(cacheKey); if (cached) { setForecasts(JSON.parse(cached)); return; } } catch {}
    }
    setLoading(true); setError(null); setTomorrowStatus("idle"); setOmStatus("idle");

    const omPromise = fetchOpenMeteoConvective(grid)
      .then(dataArr => {
        setOmStatus(dataArr.length > 0 ? "ok" : "error");
        return dataArr.map(r => {
          const days = aggregateOMConvectiveDays(r);
          return { name: r._pt.name, omDays: days };
        }).filter(p => p.omDays?.length);
      })
      .catch(e => { console.error("Open-Meteo error:", e.message); setOmStatus("error"); return []; });

    const tomorrowPromise = (!isEurope && !isUSA)
      ? fetchTomorrowForGrid(grid)
          .then(map => {
            const successCount = map.size, totalRegions = new Set(grid.map(p => p.name)).size;
            setTomorrowStatus(successCount === 0 ? "error" : successCount < totalRegions ? "partial" : "ok");
            return map;
          })
          .catch(e => { console.error("Tomorrow.io error:", e.message); setTomorrowStatus("error"); return new Map(); })
      : Promise.resolve(new Map());

    Promise.all([omPromise, tomorrowPromise]).then(([omPointResults, tomorrowMap]) => {
      if (!omPointResults.length) throw new Error("Open-Meteo returned no usable convective data.");
      const raw = { omPointResults, tomorrowMap };
      setRawModelData(raw);
      const built = buildForecasts(omPointResults, tomorrowMap, regionDefs, isEurope, isUSA, lightningStrikes);
      try { localStorage.setItem(cacheKey, JSON.stringify(built)); } catch {}
      setForecasts(built);
      setLastAdjusted(Date.now());
      setLoading(false);
    }).catch(e => { setError(e.message); setLoading(false); });
  }, [cacheKey, lightningStrikes, grid, regionDefs, isEurope, isUSA]); // eslint-disable-line

  useEffect(() => {
    const hasCached = (() => { try { return !!localStorage.getItem(cacheKey); } catch { return false; } })();
    fetchData(!hasCached);
  }, [cacheKey]); // eslint-disable-line

  // ── Derived display values ──────────────────────────────────────────────────
  const now = new Date();
  const dayDefs = [0, 1, 2, 3].map(i => {
    const d = new Date(now); d.setDate(d.getDate() + i);
    return { offset: i, label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : `Day ${i + 1}`, date: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) };
  });

  const typeObj     = RISK_TYPES.find(t => t.id === activeType) ?? RISK_TYPES[0];
  const dayForecast = forecasts?.[activeType]?.[activeDay] ?? null;
  const overrideKey = dayForecast ? `${activeType}-${dayForecast.date}` : null;
  const override    = overrideKey ? overrides[overrideKey] ?? null : null;
  const savedDesc   = dayForecast ? loadDesc(slotKey, activeType, activeDay) : null;

  const realtimeRegions = (activeDay === 0 && riskMode === "realtime" && dayForecast) ? buildRealtimeRegions(dayForecast, lightningStrikes, activeType, regionDefs) : null;
  const realtimeBlobs   = (realtimeRegions && dayForecast) ? buildRiskBlobs(realtimeRegions, typeObj.colors, regionDefs) : null;
  const displayRegions  = realtimeRegions ?? dayForecast?.regions ?? {};
  const displayBlobs    = realtimeBlobs   ?? dayForecast?.preBuiltBlobs ?? null;

  const riskIdxesDisplay   = Object.values(displayRegions).map(r => RISK_ORDER.indexOf(r.risk)).filter(v => v >= 0);
  const computedOverall    = riskIdxesDisplay.length ? RISK_ORDER[Math.max(...riskIdxesDisplay)] : (dayForecast?.overallRisk ?? "No Risk");
  const displayOverallRisk = savedDesc?.overallRisk ?? override?.overallRisk ?? computedOverall;
  const effectiveMin       = savedDesc?.minRisk ?? override?.minRisk ?? dayForecast?.minRisk ?? "No Risk";
  const effectiveMax       = savedDesc?.maxRisk ?? override?.maxRisk ?? dayForecast?.maxRisk ?? "No Risk";

  const isSevereDay  = displayOverallRisk === "Severe";
  const topColor     = isSevereDay ? "#0a0a0a" : (typeObj.colors[RISK_ORDER.indexOf(displayOverallRisk)] ?? "#64748b");
  const topColorDisp = isSevereDay ? "#555555" : topColor;
  const topHex       = topColorDisp.replace("#", "");
  const rgb          = [parseInt(topHex.slice(0, 2), 16) || 30, parseInt(topHex.slice(2, 4), 16) || 30, parseInt(topHex.slice(4, 6), 16) || 30].join(",");

  const lsColor = wsStatus === "live" ? "#22c55e" : wsStatus === "error" ? "#f87171" : "#f59e0b";
  const lm  = (l, d) => lightMode ? l : d;
  const fg  = lm("#0f172a", "#f1f5f9"), fg2 = lm("#1e293b", "#e2e8f0"), fg3 = lm("#475569", "#64748b"), fg4 = lm("#64748b", "#475569");
  const cardBg      = lightMode ? `linear-gradient(160deg,rgba(${rgb},0.08) 0%,rgba(241,245,249,0.97) 45%,rgba(226,232,240,0.99) 100%)` : `linear-gradient(160deg,rgba(${rgb},0.10) 0%,rgba(10,18,38,0.92) 45%,rgba(6,13,30,0.96) 100%)`;
  const cardBorder  = isSevereDay ? "#000" : (lightMode ? `rgba(${rgb},0.25)` : `rgba(${rgb},0.28)`);
  const inactBg     = lm("rgba(0,0,0,0.03)", "rgba(255,255,255,0.03)");
  const inactBorder = lm("rgba(0,0,0,0.1)", "rgba(255,255,255,0.08)");
  const modelsNote  = !isEurope && !isUSA ? "Tomorrow.io + Open-Meteo Ensemble (ICON-EU·GEFS·ICON-CH·IFS·AIFS·UKV)" : "Open-Meteo 6-model ensemble";

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", background: lm("#f0f4f8", "#060d1e"), minHeight: "100vh", padding: "16px", transition: "background 0.3s" }}>
      <style>{`
        @keyframes tcmPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .tcm-severe-polygon path { stroke: #000000 !important; stroke-width: 3px !important; }
        .tcm-severe-hatch-overlay { pointer-events: none !important; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(139,92,246,0.2)", border: "1px solid rgba(139,92,246,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {SVG.thunderstorm("#a78bfa", 20)}
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: fg, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            TCM {isUSA ? "USA" : isEurope ? "Europe" : "UK & Ireland"}
          </h1>
          <p style={{ margin: 0, fontSize: "0.6rem", color: fg3, letterSpacing: "0.12em", textTransform: "uppercase" }}>Thunderstorm Convective Monitoring</p>
        </div>

        {!isEurope && !isUSA && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20, background: `${lsColor}12`, border: `1px solid ${lsColor}44` }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: lsColor, flexShrink: 0, animation: wsStatus === "live" ? "tcmPulse 2s infinite" : "none" }} />
            <span style={{ fontSize: "0.6rem", fontWeight: 700, color: lsColor }}>
              {wsStatus === "live" ? `⚡ ${lightningStrikes.length}` : wsStatus === "connecting" ? "Connecting…" : "Offline"}
            </span>
          </div>
        )}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Admin availability toggle — only rendered for admin users */}
          {isAdmin && (
            <AvailabilityToggle
              available={outlookAvailable}
              onChange={handleAvailabilityChange}
            />
          )}

          {(isAdmin || !forecasts) && (
            <button onClick={() => fetchData(true)} disabled={loading}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, fontSize: "0.68rem", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.35)", color: "#a78bfa", opacity: loading ? 0.5 : 1 }}>
              {SVG.refresh("#a78bfa")}
              {loading ? "Loading…" : forecasts ? "Refresh" : "Load Data"}
            </button>
          )}

          <div style={{ fontSize: "0.62rem", color: fg4, textAlign: "right" }}>
            <div>{now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}</div>
            <div>{now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })} BST/GMT</div>
          </div>
        </div>
      </div>

      {/* ── UNAVAILABLE BANNER — shown to all users when admin disables ── */}
      {!outlookAvailable && (
        <UnavailableBanner lightMode={lightMode} />
      )}

      {/* ── Everything below is hidden when outlooks are unavailable ── */}
      {outlookAvailable && (
        <>
          {/* Risk type tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {RISK_TYPES.map(t => {
              const isActive = t.id === activeType;
              const dayF = forecasts?.[t.id]?.[activeDay];
              const savedD = dayF ? loadDesc(slotKey, t.id, activeDay) : null;
              const ovr   = dayF ? overrides[`${t.id}-${dayF.date}`] : null;
              const tRisk = savedD?.overallRisk ?? ovr?.overallRisk ?? dayF?.overallRisk;
              const tIsSevere = tRisk === "Severe";
              const tColor = tIsSevere ? "#555555" : (tRisk ? t.colors[RISK_ORDER.indexOf(tRisk)] ?? "#64748b" : "#64748b");
              return (
                <button key={t.id} onClick={() => setActiveType(t.id)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 10, fontSize: "0.74rem", fontWeight: 700, cursor: "pointer", border: `1.5px solid ${isActive ? tColor : inactBorder}`, background: isActive ? `${tColor}22` : inactBg, color: isActive ? tColor : fg3, transition: "all 0.2s" }}>
                  <TypeIcon id={t.id} color={isActive ? tColor : fg3} size={13} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Day selector */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {dayDefs.map(d => {
              const dayF = forecasts?.[activeType]?.[d.offset];
              const savedD = dayF ? loadDesc(slotKey, activeType, d.offset) : null;
              const ovr   = dayF ? overrides[`${activeType}-${dayF.date}`] : null;
              const dRisk = savedD?.overallRisk ?? ovr?.overallRisk ?? dayF?.overallRisk;
              const dIsSevere = dRisk === "Severe";
              const dc    = dIsSevere ? "#555555" : (dRisk ? typeObj.colors[RISK_ORDER.indexOf(dRisk)] ?? "#64748b" : "#64748b");
              const isAct = d.offset === activeDay;
              const hasBoost = d.offset === 0 && lightningStrikes.length > 5;
              return (
                <button key={d.offset} onClick={() => setActiveDay(d.offset)}
                  style={{ flex: 1, padding: "10px 12px", borderRadius: 12, cursor: "pointer", textAlign: "left", background: isAct ? (dIsSevere ? "rgba(0,0,0,0.35)" : `${dc}14`) : inactBg, border: `1.5px solid ${isAct ? (dIsSevere ? "#000" : dc) : inactBorder}`, transition: "all 0.2s" }}>
                  <div style={{ fontSize: "0.62rem", color: isAct ? (dIsSevere ? "#888" : dc) : fg3, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{d.label}</div>
                  <div style={{ fontSize: "0.58rem", color: isAct ? (dIsSevere ? "#666" : dc) : fg4, marginBottom: 5 }}>{d.date}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    {dIsSevere ? (
                      <svg width="7" height="7" viewBox="0 0 7 7">
                        <defs><pattern id={`ht-${d.offset}`} patternUnits="userSpaceOnUse" width="3" height="3" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="3" stroke="#333" strokeWidth="1.5" /></pattern></defs>
                        <rect width="7" height="7" rx="1.5" fill="#111" />
                        <rect width="7" height="7" rx="1.5" fill={`url(#ht-${d.offset})`} fillOpacity="0.5" />
                      </svg>
                    ) : (
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: dc, flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: "0.78rem", fontWeight: 700, color: dIsSevere ? "#ccc" : dc }}>{dRisk ?? (loading ? "…" : "—")}</span>
                    {hasBoost && <svg width="8" height="8" viewBox="0 0 8 8"><rect x="3" y="0" width="2" height="8" fill="#000" /><rect x="0" y="3" width="8" height="2" fill="#000" /></svg>}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Loading state */}
          {loading && (
            <div style={{ textAlign: "center", padding: "40px 0", color: fg3, fontSize: "0.82rem" }}>
              <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}>{SVG.thunderstorm(fg3, 32)}</div>
              <p style={{ marginBottom: 8 }}>Fetching Tomorrow.io + Open-Meteo ensemble convective data for all 4 days…</p>
              <p style={{ fontSize: "0.65rem", color: fg4 }}>Tomorrow.io: {tomorrowStatus === "ok" ? "✓" : tomorrowStatus === "error" ? "✗" : "…"} Open-Meteo: {omStatus === "ok" ? "✓" : omStatus === "error" ? "✗" : "…"}</p>
            </div>
          )}

          {/* Error state */}
          {!loading && error && (
            <div style={{ padding: "14px 16px", borderRadius: 12, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", fontSize: "0.78rem", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
              {error}
              <button onClick={() => fetchData(true)} style={{ marginLeft: "auto", fontSize: "0.7rem", color: "#a78bfa", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Retry</button>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && !forecasts && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}>{SVG.thunderstorm(fg3, 36)}</div>
              <p style={{ color: fg3, fontSize: "0.82rem", marginBottom: 16 }}>No data loaded for this forecast window.</p>
              <button onClick={() => fetchData(true)} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px", borderRadius: 12, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", background: "rgba(139,92,246,0.18)", border: "1px solid rgba(139,92,246,0.4)", color: "#a78bfa" }}>
                {SVG.refresh("#a78bfa")} Load Forecast Data
              </button>
            </div>
          )}

          {/* ── Main forecast card ── */}
          {!loading && dayForecast && (
            <div style={{ borderRadius: 22, overflow: "hidden", background: cardBg, border: `${isSevereDay ? "2px" : "1px"} solid ${cardBorder}`, boxShadow: isSevereDay ? "0 0 60px rgba(0,0,0,0.5)" : `0 0 50px rgba(${rgb},0.07)` }}>
              {isSevereDay ? (
                <div style={{ height: 6, background: "repeating-linear-gradient(45deg, #000 0px, #000 6px, #1a1a1a 6px, #1a1a1a 12px)" }} />
              ) : (
                <div style={{ height: 4, background: `linear-gradient(90deg,${topColor},${topColor}88,transparent)` }} />
              )}
              <div style={{ padding: "22px 24px" }}>

                {/* Card header */}
                <div style={{ marginBottom: 16, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 20, marginBottom: 10, background: isSevereDay ? "rgba(0,0,0,0.6)" : `rgba(${rgb},0.12)`, border: isSevereDay ? "1.5px solid #000" : `1px solid rgba(${rgb},0.3)` }}>
                      <TypeIcon id={typeObj.id} color={isSevereDay ? "#ccc" : topColor} size={12} />
                      <span style={{ fontSize: "0.64rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: isSevereDay ? "#ccc" : topColor }}>{typeObj.label} · {dayDefs[activeDay]?.label ?? ""}</span>
                      {riskMode === "realtime" && activeDay === 0 && <span style={{ fontSize: "0.6rem", fontWeight: 700, color: "#facc15", marginLeft: 4 }}>REALTIME</span>}
                    </div>
                    <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: fg, lineHeight: 1.3 }}>{dayForecast.formattedDate}</h2>
                    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                      <p style={{ margin: 0, fontSize: "0.65rem", color: fg4 }}>
                        {modelsNote} · {grid.length} grid points · 4-day forecast · Updates 00:00, 06:00, 12:00, 18:00 BST
                      </p>
                      <DataSourceStatus tomorrowStatus={tomorrowStatus} omStatus={omStatus} lightMode={lightMode} />
                      <NextUpdateCountdown lightMode={lightMode} />
                      {rawModelData && <AutoAdjustCountdown lastAdjusted={lastAdjusted} lightMode={lightMode} />}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 12, flexWrap: "wrap" }}>
                    <button onClick={() => setShowHourly(true)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 10, background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.3)", color: "#a78bfa", fontSize: "0.7rem", fontWeight: 600, cursor: "pointer" }}>
                      {SVG.clock("#a78bfa")} Hourly
                    </button>
                    {isAdmin && (
                      <button onClick={() => setEditingDay(dayForecast)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#94a3b8", fontSize: "0.7rem", fontWeight: 600, cursor: "pointer" }}>
                        {SVG.edit("#94a3b8")} Risk
                      </button>
                    )}
                  </div>
                </div>

                {/* Risk mode toggle */}
                {activeDay === 0 && !isEurope && !isUSA && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                    <span style={{ fontSize: "0.66rem", color: fg3, fontWeight: 600 }}>Risk View:</span>
                    {[{ id: "day", label: "Day Forecast", desc: "Full model blend" }, { id: "realtime", label: "Real-time", desc: "Live strike-adjusted" }].map(m => (
                      <button key={m.id} onClick={() => setRiskMode(m.id)} title={m.desc}
                        style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 9, fontSize: "0.7rem", fontWeight: 700, cursor: "pointer", border: `1.5px solid ${riskMode === m.id ? topColorDisp : inactBorder}`, background: riskMode === m.id ? `rgba(${rgb},0.15)` : inactBg, color: riskMode === m.id ? topColorDisp : fg3, transition: "all 0.2s" }}>
                        {m.id === "realtime" && <svg width="8" height="8" viewBox="0 0 8 8"><rect x="3" y="0" width="2" height="8" fill={riskMode === m.id ? topColorDisp : fg3} /><rect x="0" y="3" width="8" height="2" fill={riskMode === m.id ? topColorDisp : fg3} /></svg>}
                        {m.label}
                      </button>
                    ))}
                    {riskMode === "realtime" && <span style={{ fontSize: "0.62rem", color: fg4 }}>{lightningStrikes.length > 0 ? `Using ${lightningStrikes.length} live strikes to adjust risk zones` : "Waiting for live strikes…"}</span>}
                  </div>
                )}

                {/* Forecast description */}
                <ForecastDescription
                  forecast={dayForecast}
                  dayOffset={activeDay}
                  activeType={activeType}
                  isAdmin={isAdmin}
                  lightMode={lightMode}
                  lightningCount={activeDay === 0 ? lightningStrikes.length : 0}
                  wsStatus={wsStatus}
                  slotKey={slotKey}
                />

                {/* Lightning strike indicator */}
                {lightningStrikes.length > 0 && activeDay === 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 12, background: "rgba(0,0,0,0.1)", border: "1px solid rgba(0,0,0,0.25)" }}>
                      <svg width="9" height="9" viewBox="0 0 9 9"><rect x="3" y="0" width="2" height="9" fill="#000" /><rect x="0" y="3" width="9" height="2" fill="#000" /></svg>
                      <span style={{ fontSize: "0.62rem", color: lm("#1e293b", "#e2e8f0"), fontWeight: 700 }}>{lightningStrikes.length} live strikes (today)</span>
                    </div>
                    <span style={{ fontSize: "0.62rem", color: fg4, fontFamily: "monospace", marginLeft: "auto" }}>CAPE ~{dayForecast.avgCape} · RH ~{dayForecast.avgRH}%</span>
                  </div>
                )}

                {/* Map + risk key */}
                <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <RiskMap
                      regionData={displayRegions}
                      typeColors={typeObj.colors}
                      activeTypObj={typeObj}
                      preBuiltBlobs={displayBlobs}
                      lightMode={lightMode}
                      regionDefs={regionDefs}
                      isEurope={isEurope}
                      isUSA={isUSA}
                      lightningStrikes={activeDay === 0 ? lightningStrikes : []}
                      showLightning={activeDay === 0}
                      mapId={`main-${activeType}-${activeDay}-${riskMode}`}
                      key={`${activeType}-${activeDay}-${lightMode}-${regionKey}-${riskMode}`}
                    />
                  </div>

                  {/* Risk key */}
                  <div style={{ flexShrink: 0, width: 105, display: "flex", flexDirection: "column", gap: 4, paddingTop: 4 }}>
                    <p style={{ margin: "0 0 6px", fontSize: "0.58rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: fg4 }}>{typeObj.label} Key</p>
                    {RISK_ORDER.slice(1).map((level, i) => {
                      const rIdx = i + 1;
                      const isSevereLevel = rIdx === 6;
                      const color = typeObj.colors[rIdx];
                      const hasRegion = Object.values(displayRegions).some(r => r.risk === level);
                      return (
                        <div key={level} style={{ display: "flex", alignItems: "center", gap: 6, opacity: hasRegion ? 1 : 0.35 }}>
                          {isSevereLevel ? <SevereKeyIcon size={14} /> : <span style={{ width: 14, height: 14, borderRadius: 3, background: color, flexShrink: 0, border: "1.5px solid rgba(0,0,0,0.3)", boxShadow: `0 0 0 1px ${color}` }} />}
                          <span style={{ fontSize: "0.62rem", fontWeight: hasRegion ? 700 : 400, color: lightMode ? (hasRegion ? "#1e293b" : "#94a3b8") : (hasRegion ? (isSevereLevel ? "#e2e8f0" : color) : fg4), whiteSpace: "nowrap" }}>{level}</span>
                        </div>
                      );
                    })}
                    {activeDay === 0 && !isEurope && !isUSA && (<>
                      <div style={{ marginTop: 8, height: 1, background: "rgba(255,255,255,0.07)" }} />
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="4" y="0" width="2" height="10" fill="#000" /><rect x="0" y="4" width="10" height="2" fill="#000" /></svg>
                        <span style={{ fontSize: "0.58rem", color: lm("#1e293b", "#e2e8f0"), fontWeight: 700 }}>Live strike</span>
                      </div>
                      <p style={{ margin: "2px 0 0", fontSize: "0.54rem", color: fg4 }}>Accumulated today</p>
                    </>)}
                    <div style={{ marginTop: 6, height: 1, background: "rgba(255,255,255,0.06)" }} />
                    <p style={{ margin: "4px 0 0", fontSize: "0.56rem", color: fg4, lineHeight: 1.5 }}>Faded = no active risk</p>
                  </div>
                </div>

                {/* Regional breakdown */}
                <RegionalBreakdown regions={displayRegions} typeColors={typeObj.colors} lightMode={lightMode} />

                {/* Lightning verification (today only) */}
                {!isEurope && !isUSA && activeDay === 0 && (
                  <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                      <svg width="14" height="14" viewBox="0 0 14 14"><rect x="5.5" y="0" width="3" height="14" rx="1" fill="#000" /><rect x="0" y="5.5" width="14" height="3" rx="1" fill="#000" /></svg>
                      <span style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: lm("#1e293b", "#e2e8f0") }}>Live Lightning Verification</span>
                      <span style={{ fontSize: "0.62rem", color: fg4 }}>Blitzortung · accumulated today</span>
                    </div>
                    <LightningVerificationMap dayForecast={dayForecast} typeObj={typeObj} lightningStrikes={lightningStrikes} wsStatus={wsStatus} lightMode={lightMode} />
                  </div>
                )}

                {/* Footer */}
                <p style={{ margin: "8px 0 0", fontSize: "0.6rem", color: fg4 }}>
                  {modelsNote} · {grid.length} grid points · 4-day forecast · Cache slot {slotKey} BST · AI descriptions generated per day &amp; model cycle · Scoring: ConvectiveScorer v1
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {showHourly && forecasts && <HourlyPlaybackModal forecasts={forecasts} activeType={activeType} onClose={() => setShowHourly(false)} />}
      {editingDay && (
        <RiskEditModal
          forecast={editingDay}
          currentOverride={overrides[`${editingDay.type}-${editingDay.date}`] ?? null}
          onSave={(data) => {
            const key = `${editingDay.type}-${editingDay.date}`;
            if (data === null) { setOverrides(prev => { const next = { ...prev }; delete next[key]; return next; }); }
            else { setOverrides(prev => ({ ...prev, [key]: data })); }
          }}
          onClose={() => setEditingDay(null)}
        />
      )}
    </div>
  );
}