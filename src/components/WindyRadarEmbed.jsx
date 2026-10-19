/* ════════════════════════════════════════════════════════════════════════════
   MyWeatherUK — Radar
   ────────────────────────────────────────────────────────────────────────────
   Precipitation from RainViewer's public tiles, recoloured onto the house
   palette and drawn over a dark Esri basemap. Lightning is live from
   Blitzortung — seeded from the store the TCM lightning pages fill and topped
   up from the server's own table where it has one — plotted with the identical
   age→colour ramp so the two pages agree.

   INTENSITY AND PHASE ARE DECODED, NOT GUESSED. RainViewer's public tier serves
   one fixed palette regardless of the `color` parameter — and publishes it, in
   two halves, rain and snow. `lib/radarPalette` reverses it exactly, so every
   pixel yields a real dBZ and a real phase. Snow, sleet and freezing rain are
   then separated by a thermal field (`lib/precipPhase`), because reflectivity
   alone cannot tell them apart and no free radar publishes the distinction.

   TILES ARE 256 CSS PIXELS, ALWAYS. Leaflet derives tile indices by dividing
   map pixel bounds (a 256-per-tile coordinate space) by `tileSize`, but builds
   the URL from `zoom + zoomOffset`. Setting tileSize to 512 without a matching
   zoomOffset of -1 therefore asks for zoom-z tiles while laying them out on a
   zoom-(z-1) grid: every tile lands in the wrong place at twice its proper
   size. High-DPI sharpness comes from an oversized canvas backing store
   instead, which does not touch the grid maths.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  RefreshCw, Radar, Maximize2, X, Play, Pause, Zap,
  ChevronLeft, ChevronRight, Crosshair, AlertTriangle,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { strikeColor, makeCircleIcon } from '@/components/tcm/lightningHelpers';
import useBlitzortung from '@/components/tcm/useBlitzortung';
import WarningsRefreshBadge from '@/components/home/WarningsRefreshBadge';
import { useTheme } from '@/components/ThemeContext';
import { loadTodayStrikes } from '@/components/tcm/strikeStorage';
import { ensureLeaflet } from '@/lib/leafletLoader';
import {
  buildPhaseLUT, lutIndex, describe, rateFor, rampColour, DBZ_FLOOR, DBZ_MIN,
  decodePacked, SNOW_FLAG,
} from '@/lib/radarPalette';
import { loadPhaseField, phaseField, sampleField, classify } from '@/lib/precipPhase';

const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';

/* The radar covers the UK and Ireland, so the strike feed is bounded to match —
   filtering at the socket is far cheaper than plotting and discarding. */
/* The radar imagery is UK-centred but the map pans and zooms, and lightning
   was being filtered to the British Isles alone — so on the overwhelming
   majority of days you switched the overlay on, got a correctly-connected
   socket, and saw nothing at all, because the UK simply was not having any.
   Catching the whole of Europe means the overlay has something to show
   whenever anywhere in range does, and strikes outside the current view cost
   nothing: the map clips them until you pan or zoom out to look. */
const RADAR_BBOX = { lonMin: -25, lonMax: 35, latMin: 33, latMax: 72 };
const PHASE_LUT = buildPhaseLUT();
const TILE_CSS = 256;            // must match Leaflet's tile-index maths
const KEY_PREF = 'mwuk_radar_key';
const RADAR_PANE = 'mwukRadar';

/* Playback. The dwell is short enough to read as motion and long enough to
   settle on a clean frame: the cross-fade is 170 ms, so a 460 ms step spends
   most of itself showing one frame rather than two blended together. The
   newest observation is held far longer, which is the convention every radar
   loop follows — it is the frame anyone actually came to look at. */
const DWELL = 460;
const DWELL_FORECAST = 620;
const HOLD_NEWEST = 1500;
const MAX_NATIVE_ZOOM = 7;

/* ── Shared overlay styling ──────────────────────────────────────────────── */
const veil = {
  position: 'absolute', inset: 0, zIndex: 450, display: 'flex', alignItems: 'center',
  justifyContent: 'center', background: 'rgba(11,18,32,0.85)',
};
/* The overlay pills. Deliberately quiet: enough ground behind them to stay
   legible over a bright echo, not enough to compete with one. */
const chipBase = {
  position: 'absolute', zIndex: 500,
  background: 'var(--rdr-panel)', backdropFilter: 'blur(4px)',
  border: '1px solid rgba(148,163,184,0.16)', borderRadius: 8, padding: '4px 9px',
};
const chip = (top, left) => ({ ...chipBase, top, left, display: 'flex', alignItems: 'center', gap: 8 });
/* Ghost transport. Background, border and padding are left to CSS so the hover
   state can actually apply — an inline background would outrank it. */
const transportBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24, borderRadius: 6, cursor: 'pointer', flexShrink: 0,
  color: 'var(--rdr-dim)',
};
/* ── Legend pieces ───────────────────────────────────────────────────────────
   The bars are gradients rather than rows of swatches: the renderer
   interpolates continuously between the ramp's stops, so a row of squares
   would claim a banding the map does not actually draw. The dBZ scale under
   the rain bar carries the steps instead, which is where a reader looks for
   them anyway. */
const legendKey = {
  width: 40, flexShrink: 0, fontSize: 8.5, fontWeight: 600, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--rdr-dim)',
};
const hexOf = (key, dbz) => {
  const [r, g, b] = rampColour(key, dbz);
  return `rgb(${r},${g},${b})`;
};
const SCALE_LO = 5;
const SCALE_HI = 68;
/** A ramp as a CSS gradient, sampled finely enough to read as continuous. */
const rampGradient = (key) => {
  const steps = 22;
  const stops = [];
  for (let i = 0; i <= steps; i += 1) {
    const dbz = SCALE_LO + ((SCALE_HI - SCALE_LO) * i) / steps;
    stops.push(`${hexOf(key, dbz)} ${((i / steps) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
};
const bar = (height) => ({
  flex: 1, height, display: 'block', borderRadius: 3,
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.07)',
});

/* ── Recoloured tile layer ───────────────────────────────────────────────────
   Each tile is fetched unblurred (the `0` option) and repainted: every pixel is
   decoded to an exact reflectivity and phase from RainViewer's published
   palette, assigned one of four precipitation types, and drawn in that type's
   ramp. The reflectivity and the type are kept alongside the tile so a tap on
   the map can report what the radar actually measured rather than guessing back
   from the drawn colour.

   PHASE IS SAMPLED ON A LATTICE, NOT PER PIXEL. The thermal field behind it
   varies over tens of kilometres, so sampling it 262,144 times per tile would
   buy nothing; a 16×16 lattice is already far finer than the field itself. The
   lattice is spaced linearly in latitude across the tile, which Mercator is
   not — over one tile that error is a few hundred metres against a field whose
   own spacing is fifty kilometres. */
/* ── Decoded-tile cache ──────────────────────────────────────────────────────
   Zooming in and back out used to fetch and re-decode every tile again, for
   every frame of the loop. A decoded tile never changes (a RainViewer frame
   path is immutable), so the finished canvas and its dBZ/phase buffers are
   kept, least-recently-used first out. Budget in pixels so a high-DPI screen
   (512-pixel tiles, four times the memory) keeps proportionally fewer. */
const TILE_CACHE = new Map();
const TILE_CACHE_PIXELS = 110e6;
let tileCachePixels = 0;
function cacheGet(key) {
  const hit = TILE_CACHE.get(key);
  if (hit) { TILE_CACHE.delete(key); TILE_CACHE.set(key, hit); }   // most recent last
  return hit;
}
function cachePut(key, entry) {
  if (TILE_CACHE.has(key)) return;
  TILE_CACHE.set(key, entry);
  tileCachePixels += entry.canvas.width * entry.canvas.height;
  while (tileCachePixels > TILE_CACHE_PIXELS && TILE_CACHE.size) {
    const [k, old] = TILE_CACHE.entries().next().value;
    TILE_CACHE.delete(k);
    tileCachePixels -= old.canvas.width * old.canvas.height;
  }
}

function makeRecolourLayer(L, { host, path, srcSize }) {
  const BLOCKS = 16;
  const blockShift = Math.round(Math.log2(srcSize / BLOCKS));

  const Recolour = L.GridLayer.extend({
    createTile(coords, done) {
      const tile = document.createElement('canvas');
      tile.width = srcSize;                  // backing store: 512 on high-DPI
      tile.height = srcSize;                 // CSS size is set by Leaflet to 256
      const ctx = tile.getContext('2d', { willReadFrequently: true });

      const key = `${coords.z}/${coords.x}/${coords.y}`;
      const cacheKey = `${path}/${srcSize}/${key}`;
      const cached = cacheGet(cacheKey);
      if (cached) {
        ctx.drawImage(cached.canvas, 0, 0);
        this._dbz.set(key, cached.dbz);
        this._phase.set(key, cached.phase);
        Promise.resolve().then(() => done(null, tile));      // Leaflet expects done() after return
        return tile;
      }
      const src = `${host}${path}/${srcSize}/${coords.z}/${coords.x}/${coords.y}/2/0_1.png`;
      const img = new Image();
      img.crossOrigin = 'anonymous';         // RainViewer sends A-C-A-O: *
      img.src = src;

      img.onload = () => {
        try {
          ctx.clearRect(0, 0, srcSize, srcSize);
          ctx.drawImage(img, 0, 0, srcSize, srcSize);
          const image = ctx.getImageData(0, 0, srcSize, srcSize);
          const d = image.data;
          const dbzOf = new Int8Array(srcSize * srcSize).fill(-128);
          const phaseOf = new Uint8Array(srcSize * srcSize);   // 0 = nothing here

          /* The thermal lattice for this tile. */
          const field = phaseField();
          const b = this._tileCoordsToBounds(coords);
          const north = b.getNorth(); const south = b.getSouth();
          const west = b.getWest(); const east = b.getEast();
          const tw = new Array(BLOCKS * BLOCKS);
          const fzl = new Array(BLOCKS * BLOCKS);
          for (let by = 0; by < BLOCKS; by += 1) {
            const lat = north + (south - north) * ((by + 0.5) / BLOCKS);
            for (let bx = 0; bx < BLOCKS; bx += 1) {
              const lon = west + (east - west) * ((bx + 0.5) / BLOCKS);
              const s = sampleField(field, lat, lon);
              tw[by * BLOCKS + bx] = s.tw;
              fzl[by * BLOCKS + bx] = s.fzl;
            }
          }

          let p = 0;
          for (let py = 0; py < srcSize; py += 1) {
            const brow = (py >> blockShift) * BLOCKS;
            const qrow = py * srcSize;
            for (let px = 0; px < srcSize; px += 1, p += 4) {
              const alpha = d[p + 3];
              if (alpha === 0) continue;
              const code = decodePacked(d[p], d[p + 1], d[p + 2], alpha);
              const dbz = code < 0 ? -999 : (code & 0x1ff) + DBZ_MIN;
              // Below the floor it is clutter as often as precipitation, and
              // anything the palette does not contain is not ours to draw.
              if (dbz < DBZ_FLOOR) { d[p + 3] = 0; continue; }

              const bi = brow + (px >> blockShift);
              const ph = classify(tw[bi], fzl[bi], (code & SNOW_FLAG) !== 0);
              const o = lutIndex(ph, dbz);
              d[p] = PHASE_LUT[o];
              d[p + 1] = PHASE_LUT[o + 1];
              d[p + 2] = PHASE_LUT[o + 2];
              d[p + 3] = PHASE_LUT[o + 3];

              const q = qrow + px;
              dbzOf[q] = dbz;
              phaseOf[q] = ph + 1;
            }
          }
          ctx.putImageData(image, 0, 0);
          const keep = document.createElement('canvas');
          keep.width = srcSize; keep.height = srcSize;
          keep.getContext('2d').drawImage(tile, 0, 0);
          cachePut(cacheKey, { canvas: keep, dbz: dbzOf, phase: phaseOf });
          this._dbz.set(key, dbzOf);
          this._phase.set(key, phaseOf);
          done(null, tile);
        } catch (e) {
          // A tainted canvas would leave the raw RainViewer tile drawn, which
          // is still readable — better than a blank square.
          done(e, tile);
        }
      };
      /* RainViewer's CDN intermittently answers a tile without its CORS header
         — under load, or from an edge that cached a bad response. The browser
         then caches THAT, and the tile stays blank for the rest of the session
         however many times the map is panned back over it. One retry past the
         cache is enough; a second failure is a real failure. */
      let retried = false;
      img.onerror = (e) => {
        if (retried) { done(e, tile); return; }
        retried = true;
        img.src = `${src}?_=${Date.now()}`;
      };
      return tile;
    },
  });

  const layer = new Recolour({
    tileSize: TILE_CSS,
    opacity: 0,
    pane: RADAR_PANE,
    maxNativeZoom: MAX_NATIVE_ZOOM,
    maxZoom: 9,
    className: 'mwuk-radar-tiles mwuk-crisp',
    updateWhenZooming: false,
    keepBuffer: 2,
  });
  layer._dbz = new Map();
  layer._phase = new Map();
  layer._srcSize = srcSize;
  // So the buffer pass can tell an already-loaded frame from one still coming.
  layer.on('load', () => { layer._ready = true; });
  // Without this the decoded buffers would grow for every tile ever panned
  // over and never shrink.
  layer.on('tileunload', (e) => {
    const key = `${e.coords.z}/${e.coords.x}/${e.coords.y}`;
    layer._dbz.delete(key);
    layer._phase.delete(key);
  });
  return layer;
}

/** What the radar measured under a lat/lng, or null where we hold no tile. */
function sampleAt(map, layer, latlng) {
  if (!map || !layer?._dbz) return null;
  const z = Math.min(MAX_NATIVE_ZOOM, Math.round(map.getZoom()));
  const p = map.project(latlng, z);
  const tx = Math.floor(p.x / TILE_CSS);
  const ty = Math.floor(p.y / TILE_CSS);
  const key = `${z}/${tx}/${ty}`;
  const dbzOf = layer._dbz.get(key);
  if (!dbzOf) return null;

  const src = layer._srcSize;
  const scale = src / TILE_CSS;
  const px = Math.min(src - 1, Math.floor((p.x - tx * TILE_CSS) * scale));
  const py = Math.min(src - 1, Math.floor((p.y - ty * TILE_CSS) * scale));
  const i = py * src + px;
  const phase = layer._phase.get(key)?.[i] || 0;
  return { dbz: phase ? dbzOf[i] : null, phase: phase ? phase - 1 : null };
}

export default function WindyRadarEmbed() {
  const { isDark } = useTheme();
  const REFRESH_INTERVAL = 5 * 60 * 1000;
  const BOUNDARY_MINS = 5;

  const [refreshKey, setRefreshKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [lightningOn, setLightningOn] = useState(false);
  const [lightningLive, setLightningLive] = useState(false);
  /* The REAL next-update instant, not a countdown that resets itself. The old
     ticker reset to a full five minutes whenever you pressed Refresh, so it
     drifted away from the clock boundary the radar actually reloads on and
     told you the wrong time until the next natural boundary resynced it. */
  const [nextRadarUpdate, setNextRadarUpdate] = useState(null);

  const [frames, setFrames] = useState([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [radarReady, setRadarReady] = useState(false);
  const [radarError, setRadarError] = useState(false);
  const [strikeCount, setStrikeCount] = useState(null);

  /* Carried across the fullscreen switch, which unmounts one map and mounts
     another — without it you would zoom into your town, go fullscreen and be
     thrown back out to the whole country. */
  const viewRef = useRef({ center: [54.6, -2.6], zoom: 5 });

  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [fullscreen]);

  /* Auto-refresh aligned to the 5-minute boundary. */
  useEffect(() => {
    let timeout;
    const schedule = () => {
      const now = new Date();
      const next = new Date(now);
      const mins = Math.floor(now.getMinutes() / BOUNDARY_MINS) * BOUNDARY_MINS + BOUNDARY_MINS;
      if (mins >= 60) next.setHours(next.getHours() + 1, mins % 60, 0, 0);
      else next.setMinutes(mins, 0, 0);
      setNextRadarUpdate(next);
      timeout = setTimeout(() => {
        setRefreshKey((p) => p + 1);
        schedule();
      }, Math.max(1000, next - new Date()));
    };
    schedule();
    return () => clearTimeout(timeout);
  }, [REFRESH_INTERVAL]);

  /* A manual refresh reloads the imagery but does NOT move the boundary: the
     feed publishes on the clock whatever we do, so pretending otherwise is
     what made the old countdown lie. */
  const handleManualRefresh = () => setRefreshKey((p) => p + 1);

  /* Frame index. Past frames are observed; any nowcast entries extend the loop
     into the near future, but we never depend on them existing. */
  useEffect(() => {
    let cancelled = false;
    setRadarReady(false);
    setRadarError(false);
    (async () => {
      try {
        const res = await fetch(RAINVIEWER_API, { cache: 'no-store' });
        if (!res.ok) throw new Error(`RainViewer ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const host = data.host || 'https://tilecache.rainviewer.com';
        const past = (data.radar?.past || []).map((f) => ({ ...f, host, kind: 'past' }));
        const soon = (data.radar?.nowcast || []).map((f) => ({ ...f, host, kind: 'nowcast' }));
        const all = [...past, ...soon];
        if (!all.length) { setRadarError(true); return; }

        /* Wait for the thermal field BEFORE any tile is built, so each one is
           painted with its phase the first time. The alternative — paint now,
           redraw when the field lands — asks RainViewer for every tile of every
           cached frame at once, which is a large enough burst that their CDN
           starts answering without CORS headers and the map goes blank. Four
           seconds is the cap: a slow field must never hold up the radar. */
        await Promise.race([
          loadPhaseField().catch(() => null),
          new Promise((r) => setTimeout(r, 4000)),
        ]);
        if (cancelled) return;

        setFrames(all);
        setFrameIdx(Math.max(0, past.length - 1));   // open on the newest observed
        setRadarReady(true);
      } catch {
        if (!cancelled) setRadarError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  /* ── Lightning strikes ────────────────────────────────────────────────────
   * This overlay used to read `historicalLightning` once and plot the result.
   * That reads the LightningStrike table, which nothing fills on a self-hosted
   * install, so it drew nothing — and even with a populated table it was a
   * single fetch that never updated, so strikes arriving while you watched the
   * radar never appeared.
   *
   * It is now live off Blitzortung, seeded from the store the TCM lightning
   * pages already write to (so switching over from that page shows the day's
   * strikes immediately) and topped up with anything the server does have.
   * Strikes are batched into state every couple of seconds rather than one
   * render per strike.
   */
  const [strikes, setStrikes] = useState([]);
  const pendingRef = useRef([]);

  const onStrike = useCallback((s) => {
    pendingRef.current.push(s);
  }, []);

  useBlitzortung({
    enabled: lightningOn, bbox: RADAR_BBOX, onStrike,
    onStatus: (st) => setLightningLive(st === 'live'),
  });

  useEffect(() => {
    if (!lightningOn) return undefined;

    const inBox = (s) =>
      Number.isFinite(s?.lat) && Number.isFinite(s?.lon) &&
      s.lat >= RADAR_BBOX.latMin && s.lat <= RADAR_BBOX.latMax &&
      s.lon >= RADAR_BBOX.lonMin && s.lon <= RADAR_BBOX.lonMax;

    // Seed: whatever the lightning pages have already collected today.
    let seed = [];
    try { seed = (loadTodayStrikes() || []).filter(inBox); } catch { seed = []; }
    setStrikes(seed);

    // And anything the server holds, for installs that do populate the table.
    let cancelled = false;
    (async () => {
      try {
        const r = await base44.functions.invoke('historicalLightning', { region: 'uk', daysBack: 0 });
        const fromDb = (r?.data?.strikes || r?.strikes || []).filter(inBox);
        if (cancelled || !fromDb.length) return;
        setStrikes((prev) => {
          const seen = new Set(prev.map((s) => `${s.time}|${s.lat}|${s.lon}`));
          return [...prev, ...fromDb.filter((s) => !seen.has(`${s.time}|${s.lat}|${s.lon}`))];
        });
      } catch { /* the toggle badge conveys availability */ }
    })();

    const flush = setInterval(() => {
      if (!pendingRef.current.length) return;
      const incoming = pendingRef.current;
      pendingRef.current = [];
      setStrikes((prev) => [...prev, ...incoming].slice(-6000));
    }, 2000);

    return () => { cancelled = true; clearInterval(flush); };
  }, [lightningOn, refreshKey]);

  useEffect(() => {
    setStrikeCount(lightningOn ? strikes.length : null);
  }, [lightningOn, strikes.length]);

  const activeFrame = frames[frameIdx];
  const frameLabel = activeFrame
    ? new Date(activeFrame.time * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '—';

  const controls = {
    frames, frameIdx, setFrameIdx, playing, setPlaying,
    radarReady, radarError, lightningOn, strikes, refreshKey,
    frameLabel, isForecastFrame: activeFrame?.kind === 'nowcast',
    viewRef, onRetry: handleManualRefresh,
  };

  /* NO TITLE IN HERE. The home page already prints "Observed / Rain radar"
     above this through its own SectionHeader, so the component's own heading
     stacked a second title under the first — two headings, two eyebrows, one
     section. The pane it sits in is `pad={false}`, which means this component
     owns the whole box edge to edge: one toolbar strip, then the map filling
     everything below it. The map used to be a 650px card centred in a 1100px
     pane, which left a third of the section empty on either side of the one
     thing people come here to look at. */
  const toolbar = (
    <>
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <button
          type="button"
          aria-pressed={lightningOn}
          onClick={() => setLightningOn((v) => !v)}
          style={chipBtn(lightningOn, '#facc15')}>
          <Zap className="w-3.5 h-3.5" />
          Lightning
          {lightningOn && (
            <span className="inline-flex items-center gap-1.5 ml-1">
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: lightningLive ? '#34d399' : '#f59e0b',
                boxShadow: `0 0 6px ${lightningLive ? '#34d399' : '#f59e0b'}`,
              }} />
              <span className="text-[11px] font-bold tabular-nums">
                {(strikeCount ?? 0).toLocaleString()}
              </span>
            </span>
          )}
        </button>
        {/* ZERO IS AN ANSWER, and it used to look like a fault. The count was
            hidden unless it was above zero, so switching lightning on over a
            quiet UK gave you a pressed button and an empty map with no way to
            tell "connected, nothing striking" from "broken". */}
        {lightningOn && (
          <span className="text-[11.5px] truncate" style={{ color: 'var(--text-muted)' }}>
            {lightningLive
              ? (strikeCount ? 'Last 2 hours — newest brightest' : 'Connected — nothing striking in range')
              : 'Connecting…'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <WarningsRefreshBadge
          nextUpdate={nextRadarUpdate}
          slotMs={REFRESH_INTERVAL}
          alwaysVisible
          title="Radar imagery refreshes every five minutes, on the clock — opening the page does not trigger a fetch." />
        <button type="button" onClick={handleManualRefresh} style={chipBtn(false)} title="Refresh now">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
        <button type="button" onClick={() => setFullscreen(true)} style={chipBtn(false)}>
          <Maximize2 className="w-3.5 h-3.5" /> Fullscreen
        </button>
      </div>
    </>
  );

  return (
    <div className="w-full">
      <div
        className="flex items-center justify-between gap-3 flex-wrap"
        style={{ padding: '11px 13px', borderBottom: '1px solid var(--border)' }}>
        {toolbar}
      </div>

      {/* Only ever ONE live map. Leaving the inline one mounted behind the
          fullscreen overlay meant two Leaflet instances, two animation loops
          and two sets of tile recolouring running against each other. */}
      {!fullscreen && (
        <div
          className="relative w-full"
          style={{ background: isDark ? '#0b1220' : '#e8eef6', aspectRatio: '16 / 9', maxHeight: '70vh' }}>
          <RadarCanvas {...controls} />
        </div>
      )}

      {fullscreen && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: isDark ? '#020617' : '#f1f5f9', display: 'flex', flexDirection: 'column' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', background: isDark ? 'rgba(2,6,23,0.95)' : 'rgba(255,255,255,0.96)',
            borderBottom: '1px solid rgba(148,163,184,0.2)', flexWrap: 'wrap', gap: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: isDark ? '#f8fafc' : '#0f172a', fontWeight: 700 }}>
              <Radar className="w-5 h-5" style={{ color: '#38bdf8' }} /> Radar
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" aria-pressed={lightningOn}
                      onClick={() => setLightningOn((v) => !v)} style={ovBtn(lightningOn, '#facc15')}>
                <Zap className="w-4 h-4" /> Lightning
              </button>
              <button type="button" onClick={() => setFullscreen(false)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#fff', background: '#e0322f', border: 'none' }}>
                <X className="w-4 h-4" /> Exit
              </button>
            </div>
          </div>
          <div style={{ flex: 1, position: 'relative' }}>
            <RadarCanvas {...controls} fullscreen />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/* One chip style for the whole radar toolbar. The header buttons were shadcn
   `<Button variant="outline">` and the overlay toggles were hand-rolled
   Tailwind with a different radius, border and hover treatment — so a single
   row held two different ideas of what a button looks like, neither of them
   the one the rest of the home page uses. */
function chipBtn(active, accent = '#38bdf8') {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 13px', borderRadius: 999,
    fontSize: 12.5, fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    color: active ? accent : 'var(--text-secondary)',
    background: active ? `${accent}1A` : 'var(--bg-surface)',
    border: `1px solid ${active ? `${accent}66` : 'var(--border)'}`,
    transition: 'background 180ms ease, color 180ms ease, border-color 180ms ease',
  };
}

function ovBtn(active, accent) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999,
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    color: active ? accent : 'var(--text-secondary)',
    background: active ? 'rgba(56,189,248,0.10)' : 'var(--bg-surface)',
    border: `1px solid ${active ? accent : 'rgba(148,163,184,0.3)'}`,
  };
}

/* ── Map + radar renderer ────────────────────────────────────────────────── */
function RadarCanvas({
  frames, frameIdx, setFrameIdx, playing, setPlaying,
  radarReady, radarError, lightningOn, strikes = [],
  frameLabel, isForecastFrame, refreshKey, viewRef, onRetry,
  fullscreen = false,
}) {
  /* THE MAP HAS TO FOLLOW THE SITE THEME. Everything here was pinned to the
     dark basemap: a dark-grey Esri canvas, a near-black container behind it and
     a `screen` blend for the radar tiles. On the light theme that left a black
     rectangle in the middle of a white page. */
  const { isDark } = useTheme();
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const activeLayerRef = useRef(null);
  const lightningRef = useRef(null);
  const locateRef = useRef(null);
  const LRef = useRef(null);
  const sweepRef = useRef(null);
  const frameIdxRef = useRef(0);

  const [probe, setProbe] = useState(null);     // { lat, lon, s: {dbz, phase} | null }
  const [located, setLocated] = useState(null); // { lat, lon, accuracy }
  const [loadedCount, setLoadedCount] = useState(0);
  const [buffered, setBuffered] = useState(false);
  /* Leaflet is loaded asynchronously, so the frame list can be ready before
     there is a map to hang layers on. Buffering waits for this rather than
     racing it — without it the first layer request returned nothing, the
     buffer pass fell straight through, and the timeline sat permanently
     greyed as though it had never loaded. */
  const [mapReady, setMapReady] = useState(false);

  /* Whether the key is showing. Remembered per browser: someone who has read
     it once should not have to close it on every visit. */
  const [keyOpen, setKeyOpen] = useState(() => {
    try { return localStorage.getItem(KEY_PREF) !== 'hidden'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(KEY_PREF, keyOpen ? 'shown' : 'hidden'); } catch { /* storage blocked */ }
  }, [keyOpen]);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');

  useEffect(() => {
    let disposed = false;
    ensureLeaflet().then((L) => {
      if (disposed || !elRef.current) return;
      LRef.current = L;
      const map = L.map(elRef.current, {
        center: viewRef.current.center,
        zoom: viewRef.current.zoom,
        minZoom: 4,
        maxZoom: 9,
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: fullscreen,
        worldCopyJump: true,
      });

      /* Radar gets its own pane so the screen blend happens ONCE, against the
         basemap, instead of once per layer. Blending each layer separately
         meant that mid-cross-fade the outgoing and incoming frames screened
         against each other, and since consecutive frames overlap almost
         everywhere, the precipitation visibly brightened on every step of the
         loop — a pulse, twice a second, for the whole animation. */
      map.createPane(RADAR_PANE);
      const radarPane = map.getPane(RADAR_PANE);
      radarPane.style.zIndex = 350;        // above the basemap, below its labels
      /* `screen` only works over a dark ground: it lightens, so on a pale
         basemap every radar pixel washes out to white and the rain disappears.
         Light mode composites normally instead — the tiles already carry the
         alpha for it. */
      radarPane.style.mixBlendMode = isDark ? 'screen' : 'normal';
      radarPane.style.pointerEvents = 'none';
      // Credit the sources, drop the "Leaflet" plug — it is the library's own
      // default prefix, not a data source, and it doubles the credit line.
      map.attributionControl.setPrefix(false);
      const canvas = isDark ? 'Dark' : 'Light';
      L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${canvas}_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
        attribution: 'Esri · RainViewer',
        maxNativeZoom: 19, maxZoom: 9, opacity: 0.9,
      }).addTo(map);
      L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${canvas}_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, {
        maxNativeZoom: 19, maxZoom: 9, opacity: 0.5, pane: 'shadowPane',
      }).addTo(map);

      // Remember where the reader was looking, so the fullscreen switch keeps it.
      const remember = () => {
        const c = map.getCenter();
        viewRef.current = { center: [c.lat, c.lng], zoom: map.getZoom() };
      };
      map.on('moveend zoomend', remember);

      /* ZOOMING ONLY RELOADS THE FRAME ON SCREEN. Every frame of the loop is a
         layer on the map (hidden ones at opacity 0), so a zoom used to make all
         thirteen fetch and decode a fresh set of tiles at once: hundreds of
         requests and seconds of main-thread decoding before the visible frame
         got its turn. Hidden frames now leave the map when a zoom starts and
         come back one at a time once it has settled, behind the visible one. */
      let reattach = 0;
      map.on('zoomstart', () => {
        reattach += 1;
        Object.values(layersRef.current).forEach((l) => {
          if (l !== activeLayerRef.current && map.hasLayer(l)) map.removeLayer(l);
        });
      });
      map.on('zoomend', () => {
        const run = ++reattach;
        const active = activeLayerRef.current;
        const waitLoad = (l) => new Promise((resolve) => {
          if (!l || !l.isLoading || !l.isLoading()) { resolve(); return; }
          const t = setTimeout(resolve, 2500);
          l.once('load', () => { clearTimeout(t); resolve(); });
        });
        (async () => {
          await waitLoad(active);
          const order = Object.values(layersRef.current);
          const start = Math.max(0, order.indexOf(active));
          for (let i = 1; i < order.length; i += 1) {
            if (run !== reattach) return;               // zoomed again: start over
            const l = order[(start + i) % order.length];
            if (!map.hasLayer(l)) { l.addTo(map); await waitLoad(l); }
          }
        })();
      });
      map.on('click', (e) => {
        setProbe({
          lat: e.latlng.lat, lon: e.latlng.lng,
          s: sampleAt(map, activeLayerRef.current, e.latlng),
        });
      });

      mapRef.current = map;
      setMapReady(true);
      setTimeout(() => { try { map.invalidateSize(); } catch { /* gone */ } }, 60);
    }).catch(() => { /* the veil below reports it */ });

    return () => {
      disposed = true;
      setMapReady(false);
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      layersRef.current = {};
      activeLayerRef.current = null;
      lightningRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen, isDark]);

  /* Drop cached frame layers when the source refreshes or the look changes. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    Object.values(layersRef.current).forEach((l) => { try { map.removeLayer(l); } catch { /* gone */ } });
    layersRef.current = {};
    activeLayerRef.current = null;
  }, [refreshKey]);

  const layerFor = useCallback((idx) => {
    const map = mapRef.current; const L = LRef.current;
    if (!map || !L) return null;
    const frame = frames[idx];
    if (!frame) return null;
    const key = String(frame.time);
    let layer = layersRef.current[key];
    if (!layer) {
      // 512-pixel source into a 256 CSS tile: sharp on high-DPI screens without
      // disturbing Leaflet's tile-index maths (see the header note).
      const srcSize = (typeof window !== 'undefined' && window.devicePixelRatio >= 2) ? 512 : 256;
      layer = makeRecolourLayer(L, { host: frame.host, path: frame.path, srcSize });
      layer.addTo(map);
      layersRef.current[key] = layer;
    } else if (!map.hasLayer(layer)) {
      layer.addTo(map);                   // detached during a zoom (see below)
    }
    return layer;
  }, [frames]);

  const showFrame = useCallback((idx) => {
    const frame = frames[idx];
    const layer = layerFor(idx);
    if (!layer || !frame) return;
    activeLayerRef.current = layer;
    const key = String(frame.time);
    Object.entries(layersRef.current).forEach(([k, l]) => {
      l.setOpacity(k === key ? (frame.kind === 'nowcast' ? 0.72 : 0.85) : 0);
    });
  }, [frames, layerFor]);

  useEffect(() => { showFrame(frameIdx); }, [frameIdx, showFrame, refreshKey]);

  /* Buffer the whole loop before it plays.
   *
   * It used to build two frames ahead of wherever the loop had got to, which
   * meant a cold tile fetch landed inside the animation rather than before it:
   * the frame advanced, its layer had nothing drawn yet, and the map blinked
   * empty for a step. On a slow connection it did that repeatedly.
   *
   * Frames are loaded ONE AT A TIME, deliberately. Asking for all thirteen at
   * once is over a hundred simultaneous tile requests, which is enough for
   * RainViewer's CDN to start answering without CORS headers — the same burst
   * that turned the map blank once already. Sequential is barely slower here,
   * because the newest frame is on screen throughout and the rest are cached.
   */
  useEffect(() => {
    if (!radarReady || !mapReady || !frames.length) return undefined;
    let cancelled = false;
    setLoadedCount(0);
    setBuffered(false);

    (async () => {
      for (let i = 0; i < frames.length; i += 1) {
        if (cancelled) return;
        const layer = layerFor(i);
        // Nothing more can be built. Do not leave the timeline greyed out
        // claiming a load that has stopped happening.
        if (!layer) { setLoadedCount(frames.length); break; }
        if (!layer._ready) {
          // A frame that never loads must not hold the loop hostage.
          await new Promise((resolve) => {
            const finish = () => { clearTimeout(bail); resolve(); };
            const bail = setTimeout(finish, 2500);
            layer.once('load', finish);
          });
        }
        if (cancelled) return;
        setLoadedCount(i + 1);
      }
      if (!cancelled) setBuffered(true);
    })();

    return () => { cancelled = true; };
  }, [radarReady, mapReady, frames, layerFor]);

  /* Re-read the probe when the frame changes, so the figure on screen always
     belongs to the frame being shown rather than the one it was tapped on. */
  useEffect(() => {
    if (!probe || !mapRef.current || !LRef.current) return;
    const L = LRef.current;
    setProbe((p) => (p ? { ...p, s: sampleAt(mapRef.current, activeLayerRef.current, L.latLng(p.lat, p.lon)) } : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameIdx]);

  /* One clock for the loop.
   *
   * The step used to be a setTimeout re-armed by an effect that depended on
   * frameIdx, so every frame tore down and rebuilt the timer — and any React
   * work in between was added to the interval, which is why the cadence
   * wandered. A single animation frame loop keeps its own accumulator, so a
   * step that arrives late is corrected on the next one instead of compounding,
   * and the position indicator moves off the same clock as the frames do.
   */
  const dwellFor = useCallback(
    (i) => (i === frames.length - 1
      ? HOLD_NEWEST
      : frames[i]?.kind === 'nowcast' ? DWELL_FORECAST : DWELL),
    [frames],
  );

  useEffect(() => {
    if (!playing || !buffered || frames.length < 2) return undefined;
    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const tick = (now) => {
      /* The browser stops calling this while the tab is hidden, which is right
         — but it means the first call on return carries however long the tab
         was away. Capping the step at one frame's worth keeps the loop from
         fast-forwarding through itself when someone comes back to it. */
      acc += Math.min(now - last, DWELL);
      last = now;
      let i = frameIdxRef.current;
      let dwell = dwellFor(i);
      if (acc >= dwell) {
        acc -= dwell;
        i = (i + 1) % frames.length;
        frameIdxRef.current = i;
        setFrameIdx(i);
        dwell = dwellFor(i);
      }
      // Written straight to the element: sixty state updates a second would
      // re-render the whole radar for the sake of a moving line.
      if (sweepRef.current) {
        const p = (i + Math.min(1, acc / dwell)) / frames.length;
        sweepRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
      }
      raf = requestAnimationFrame(tick);
    };

    const resync = () => { last = performance.now(); };
    document.addEventListener('visibilitychange', resync);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', resync);
    };
  }, [playing, buffered, frames, dwellFor, setFrameIdx]);

  /* Paused or scrubbed: the indicator still has to agree with the frame. */
  useEffect(() => {
    frameIdxRef.current = frameIdx;
    if (playing || !sweepRef.current || !frames.length) return;
    sweepRef.current.style.transform = `scaleX(${((frameIdx + 1) / frames.length).toFixed(4)})`;
  }, [frameIdx, playing, frames.length]);

  /* Lightning overlay — same feed and colour ramp as the Lightning page. */
  useEffect(() => {
    const map = mapRef.current; const L = LRef.current;
    if (!map || !L) return undefined;
    if (!lightningOn) {
      if (lightningRef.current) {
        try { map.removeLayer(lightningRef.current); } catch { /* gone */ }
        lightningRef.current = null;
      }
      return undefined;
    }
    /* Strikes arrive live from the parent. Redrawing the whole group each time
       is fine because the parent batches arrivals into ~2s windows, so this
       runs a few times a minute rather than once per strike. */
    const size = fullscreen ? 12 : 9;
    const group = L.layerGroup();
    strikes
      .slice()
      .sort((a, b) => b.time - a.time)
      .slice(0, 6000)
      .forEach((s) => {
        if (!Number.isFinite(s?.lat) || !Number.isFinite(s?.lon)) return;
        group.addLayer(L.marker([s.lat, s.lon], {
          icon: L.divIcon({
            className: 'mwuk-strike', html: makeCircleIcon(strikeColor(s.time), size),
            iconSize: [size, size], iconAnchor: [size / 2, size / 2],
          }),
          interactive: false, keyboard: false,
        }));
      });

    if (lightningRef.current) { try { map.removeLayer(lightningRef.current); } catch { /* gone */ } }
    group.addTo(map);
    lightningRef.current = group;

    return () => {
      try { map.removeLayer(group); } catch { /* map already torn down */ }
      if (lightningRef.current === group) lightningRef.current = null;
    };
  }, [lightningOn, strikes, fullscreen]);

  const step = useCallback((delta) => {
    setPlaying(false);
    setFrameIdx((i) => (i + delta + frames.length) % frames.length);
  }, [frames.length, setFrameIdx, setPlaying]);

  /* Keyboard transport, so the timeline is usable without a mouse. */
  const onKeyDown = (e) => {
    if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); setPlaying((p) => !p); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  };

  /* You are here. Leaflet ships no such marker, so the locate button used to
     recentre the map and leave you to work out which town was yours. */
  useEffect(() => {
    const map = mapRef.current; const L = LRef.current;
    if (!map || !L) return undefined;
    if (locateRef.current) {
      try { map.removeLayer(locateRef.current); } catch { /* gone */ }
      locateRef.current = null;
    }
    if (!located) return undefined;

    const group = L.layerGroup();
    // The accuracy ring is only drawn when the fix is good enough for it to
    // mean something; a 20 km circle over a county says nothing worth the ink.
    if (located.accuracy > 0 && located.accuracy < 20000) {
      group.addLayer(L.circle([located.lat, located.lon], {
        radius: located.accuracy, interactive: false,
        color: '#38bdf8', weight: 1, opacity: 0.5,
        fillColor: '#38bdf8', fillOpacity: 0.1,
      }));
    }
    group.addLayer(L.marker([located.lat, located.lon], {
      icon: L.divIcon({
        className: 'mwuk-here',
        html: '<span class="mwuk-here-pulse"></span><span class="mwuk-here-dot"></span>',
        iconSize: [16, 16], iconAnchor: [8, 8],
      }),
      interactive: false, keyboard: false, zIndexOffset: 1000,
    }));
    group.addTo(map);
    locateRef.current = group;

    return () => {
      try { map.removeLayer(group); } catch { /* map already torn down */ }
      if (locateRef.current === group) locateRef.current = null;
    };
  }, [located]);

  const locate = () => {
    if (!navigator.geolocation) { setGeoError('This browser cannot share a location.'); return; }
    setLocating(true); setGeoError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude, accuracy } = pos.coords;
        setLocated({ lat: latitude, lon: longitude, accuracy });
        mapRef.current?.setView([latitude, longitude], Math.max(8, mapRef.current.getZoom()));
        if (mapRef.current && LRef.current) {
          const ll = LRef.current.latLng(latitude, longitude);
          setProbe({ lat: latitude, lon: longitude, s: sampleAt(mapRef.current, activeLayerRef.current, ll) });
        }
      },
      () => { setLocating(false); setGeoError('Location unavailable — permission was declined or timed out.'); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  const observedCount = frames.filter((f) => f.kind === 'past').length;

  /* The on-map furniture — the key, the frame chip, the transport, the veil —
     as custom properties rather than literals, because most of it is styled in
     the <style> block below where an `isDark` ternary cannot reach. Setting
     them here means one switch flips the lot. */
  const themeVars = isDark ? {
    '--rdr-ground': '#0b1220',
    '--rdr-panel': 'rgba(2,6,23,0.58)',
    '--rdr-panel-solid': 'rgba(2,6,23,0.95)',
    '--rdr-text': '#f8fafc',
    '--rdr-dim': '#cbd5e1',
    '--rdr-hover': 'rgba(255,255,255,0.09)',
    '--rdr-scrim': 'linear-gradient(to top, rgba(2,6,23,0.85), rgba(2,6,23,0))',
  } : {
    '--rdr-ground': '#e8eef6',
    '--rdr-panel': 'rgba(255,255,255,0.82)',
    '--rdr-panel-solid': 'rgba(255,255,255,0.97)',
    '--rdr-text': '#0f172a',
    '--rdr-dim': '#475569',
    '--rdr-hover': 'rgba(15,23,42,0.07)',
    '--rdr-scrim': 'linear-gradient(to top, rgba(255,255,255,0.9), rgba(255,255,255,0))',
  };

  return (
    <div style={{ position: 'absolute', inset: 0, ...themeVars }}
         tabIndex={0} onKeyDown={onKeyDown} role="application" aria-label="Precipitation radar">
      <style>{`
        /* Linear, not eased: an eased cross-dissolve dips through its own
           midpoint. The blend itself now lives on the pane, not here. */
        .mwuk-radar-tiles { transition: opacity 170ms linear; will-change: opacity; }
        .mwuk-radar-tiles.mwuk-crisp  canvas.leaflet-tile { image-rendering: pixelated; }
        .mwuk-strike svg { filter: drop-shadow(0 0 3px rgba(255,255,255,0.55)); }

        /* You are here. */
        .mwuk-here { position: relative; }
        .mwuk-here-dot {
          position: absolute; inset: 2px; border-radius: 50%;
          background: #38bdf8; border: 2px solid #f8fafc;
          box-shadow: 0 0 0 1px rgba(2,6,23,0.65), 0 2px 6px rgba(0,0,0,0.5);
        }
        .mwuk-here-pulse {
          position: absolute; inset: 0; border-radius: 50%;
          background: rgba(56,189,248,0.45);
          animation: mwuk-here-pulse 2.2s ease-out infinite;
        }
        @keyframes mwuk-here-pulse {
          0%   { transform: scale(0.55); opacity: 0.85; }
          100% { transform: scale(2.2);  opacity: 0; }
        }
        .leaflet-container { background: var(--rdr-ground); }
        @keyframes mwuk-spin { to { transform: rotate(360deg); } }

        /* Zoom sits below the two status pills rather than on top of them —
           Leaflet's default top-left corner is exactly where they live. */
        .mwuk-radar .leaflet-top.leaflet-left { top: 84px; }
        .mwuk-radar .leaflet-control-zoom {
          border: none !important;
          box-shadow: none !important;
        }
        .mwuk-radar .leaflet-control-zoom a {
          width: 26px; height: 26px; line-height: 26px;
          background: var(--rdr-panel);
          border: 1px solid rgba(148,163,184,0.16);
          color: var(--rdr-dim); font-size: 15px; font-weight: 500;
          backdrop-filter: blur(4px);
        }
        .mwuk-radar .leaflet-control-zoom a:first-child { border-radius: 8px 8px 0 0; }
        .mwuk-radar .leaflet-control-zoom a:last-child  { border-radius: 0 0 8px 8px; border-top: none; }
        .mwuk-radar .leaflet-control-zoom a:hover { background: rgba(15,23,42,0.9); color: #f1f5f9; }

        /* Credits: present and correct, but not competing with the weather. */
        .mwuk-radar .leaflet-control-attribution {
          background: var(--rdr-panel);
          backdrop-filter: blur(3px);
          border-radius: 6px 0 0 0;
          padding: 1px 6px;
          font-size: 9px;
          line-height: 1.5;
          color: rgba(148,163,184,0.65);
        }
        .mwuk-radar .leaflet-control-attribution a { color: rgba(148,163,184,0.8); }
        .mwuk-radar .leaflet-control-attribution svg { display: none; }

        /* Transport buttons. Their ground lives here rather than inline so the
           hover state is not outranked by a style attribute. */
        .mwuk-transport {
          background: transparent; border: none; padding: 0;
          transition: background 120ms ease;
        }
        .mwuk-transport:hover { background: var(--rdr-hover); }

        /* The key's collapse control, and the tab it leaves behind. Colour is
           set here rather than inline so the hover state can win. */
        .mwuk-keytab {
          background: transparent; border: none;
          color: var(--rdr-dim);
          transition: color 120ms ease;
        }
        .mwuk-keytab:hover { color: var(--rdr-text); }
      `}</style>

      <div ref={elRef} className="mwuk-radar" style={{ position: 'absolute', inset: 0 }} />

      {(!radarReady && !radarError) && (
        <div style={veil}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--rdr-dim)', fontSize: 13 }}>
            <RefreshCw className="w-4 h-4" style={{ animation: 'mwuk-spin 1s linear infinite' }} />
            Loading radar…
          </div>
        </div>
      )}
      {radarError && (
        <div style={{ ...veil, flexDirection: 'column', gap: 10 }}>
          <AlertTriangle className="w-6 h-6" style={{ color: '#fca5a5' }} />
          <div style={{ color: '#fca5a5', fontSize: 13, textAlign: 'center', padding: '0 16px' }}>
            Radar imagery is unavailable right now.
          </div>
          <button type="button" onClick={onRetry}
                  style={{ padding: '5px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#93c5fd', background: 'rgba(96,165,250,0.16)', border: '1px solid rgba(96,165,250,0.45)' }}>
            Try again
          </button>
        </div>
      )}

      {/* Frame stamp: a dot for observed-or-forecast and the time. The glow the
          dot used to carry made a label out of what only needs to be a cue. */}
      <div style={{ ...chip(10, 10), gap: 6 }}>
        <span style={{
          width: 5, height: 5, borderRadius: 99,
          background: isForecastFrame ? '#a855f7' : '#38bdf8',
        }} />
        <span style={{ color: 'var(--rdr-text)', fontSize: 11, fontWeight: 500 }}>
          {isForecastFrame ? 'Forecast' : 'Observed'} · {frameLabel}
        </span>
      </div>

      {/* Locate */}
      <button
        type="button" onClick={locate} aria-label="Centre on my location"
        style={{ ...chip(46, 10), cursor: 'pointer', border: '1px solid rgba(148,163,184,0.25)' }}>
        <Crosshair className="w-3.5 h-3.5" style={{ color: locating ? '#facc15' : '#93c5fd' }} />
        <span style={{ color: 'var(--rdr-text)', fontSize: 11, fontWeight: 600 }}>
          {locating ? 'Locating…' : 'My location'}
        </span>
      </button>
      {geoError && (
        <div style={{ ...chip(150, 10), maxWidth: 230 }}>
          <span style={{ color: '#fca5a5', fontSize: 10.5, lineHeight: 1.35 }}>{geoError}</span>
        </div>
      )}

      {/* Key. Collapsible: on a phone it covers about as much of the map as it
          explains, and the choice is remembered between visits. Collapsed, it
          leaves a tab on the edge rather than vanishing with no way back. */}
      {keyOpen ? (
        <div style={{
          ...chipBase, top: 10, right: 10, display: 'flex', flexDirection: 'column',
          gap: 6, padding: '7px 9px 8px', width: fullscreen ? 236 : 182,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{
              fontSize: 8, fontWeight: 700, letterSpacing: '0.16em',
              textTransform: 'uppercase', color: 'rgba(148,163,184,0.7)',
            }}>
              Key
            </span>
            <button type="button" className="mwuk-keytab" onClick={() => setKeyOpen(false)}
                    aria-label="Hide the key"
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 16, height: 16, borderRadius: 4, padding: 0, cursor: 'pointer',
                    }}>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={legendKey}>Rain</span>
              <span style={{ ...bar(9), background: rampGradient('rain') }} />
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between', marginTop: 3, marginLeft: 47,
              fontSize: 7.5, letterSpacing: '0.04em', color: 'rgba(148,163,184,0.6)',
            }}>
              <span>5</span><span>35</span><span>65 dBZ</span>
            </div>
          </div>

          {[['mix', 'Sleet'], ['snow', 'Snow'], ['ice', 'Freezing']].map(([key, label]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={legendKey}>{label}</span>
              <span style={{ ...bar(6), background: rampGradient(key) }} />
            </div>
          ))}

          <div style={{
            color: 'rgba(148,163,184,0.5)', fontSize: 7.5, lineHeight: 1.35, marginTop: 1,
          }}>
            Type estimated from surface wet-bulb
          </div>
        </div>
      ) : (
        <button type="button" className="mwuk-keytab" onClick={() => setKeyOpen(true)}
                aria-label="Show the key"
                style={{
                  ...chipBase, top: 10, right: 0, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', width: 19, height: 38, padding: 0, cursor: 'pointer',
                  borderRadius: '8px 0 0 8px', borderRight: 'none',
                }}>
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Tap-to-read. Only possible because reflectivity and phase are decoded
          rather than inferred — this is the number the radar actually
          reported, in the unit it reports it in. */}
      {probe && (
        <div style={{ ...chipBase, right: 10, bottom: 76, display: 'block', maxWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#94a3b8' }}>
              At this point
            </span>
            <button type="button" onClick={() => setProbe(null)} aria-label="Clear reading"
                    style={{ cursor: 'pointer', background: 'none', border: 'none', color: '#64748b', lineHeight: 1 }}>
              <X className="w-3 h-3" />
            </button>
          </div>
          <div style={{ color: 'var(--rdr-text)', fontSize: 13, fontWeight: 700, marginTop: 2 }}>
            {!probe.s ? 'No radar data' : describe(probe.s.dbz, probe.s.phase)}
          </div>
          {probe.s && (
            <div style={{ color: 'var(--rdr-dim)', fontSize: 10, marginTop: 1 }}>
              {probe.s.dbz} dBZ
              {probe.s.phase === 0 && rateFor(probe.s.dbz) != null
                && ` · ${rateFor(probe.s.dbz) < 1 ? rateFor(probe.s.dbz).toFixed(1) : Math.round(rateFor(probe.s.dbz))} mm/h`}
            </div>
          )}
          <div style={{ color: '#94a3b8', fontSize: 9.5, marginTop: 1 }}>
            {probe.lat.toFixed(2)}°, {probe.lon.toFixed(2)}° · {frameLabel}
          </div>
        </div>
      )}

      {/* Timeline. Segments rather than a bare slider, so past and forecast are
          distinguishable and any moment is one tap away — but drawn on a scrim
          instead of in a card, so the controls read as part of the map rather
          than as a panel sitting on it. The scrim ignores the pointer; only the
          controls themselves take clicks, so the map still drags underneath. */}
      {radarReady && frames.length > 1 && (
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 500,
          padding: '28px 12px 10px', pointerEvents: 'none',
          background: 'var(--rdr-scrim)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, pointerEvents: 'auto' }}>
            <button type="button" className="mwuk-transport" onClick={() => step(-1)}
                    style={transportBtn} aria-label="Previous frame">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button type="button" className="mwuk-transport" onClick={() => setPlaying((p) => !p)}
                    style={{ ...transportBtn, color: '#38bdf8', opacity: buffered ? 1 : 0.45 }}
                    title={buffered ? undefined : 'Loading the loop…'}
                    aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button type="button" className="mwuk-transport" onClick={() => step(1)}
                    style={transportBtn} aria-label="Next frame">
              <ChevronRight className="w-4 h-4" />
            </button>

            <div style={{ flex: 1, minWidth: 0, marginLeft: 6 }}>
              <div style={{ position: 'relative', display: 'flex', gap: 2, alignItems: 'flex-end', height: 12 }}>
                {frames.map((f, i) => {
                  const on = i === frameIdx;
                  const stamp = new Date(f.time * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                  return (
                    <button
                      key={f.time}
                      type="button"
                      onClick={() => { setPlaying(false); setFrameIdx(i); }}
                      title={stamp}
                      aria-label={`${f.kind === 'nowcast' ? 'Forecast' : 'Observed'} ${stamp}`}
                      style={{
                        flex: 1, minWidth: 0, height: on ? 12 : 4, padding: 0,
                        borderRadius: 2, cursor: 'pointer', border: 'none',
                        background: on
                          ? (f.kind === 'nowcast' ? '#a855f7' : '#38bdf8')
                          : (f.kind === 'nowcast' ? 'rgba(168,85,247,0.30)' : 'rgba(148,163,184,0.30)'),
                        // A frame not yet buffered is drawn faint, so the loop
                        // visibly fills before it starts rather than the play
                        // button simply not responding.
                        opacity: i < loadedCount ? 1 : 0.3,
                        transition: 'height 0.18s cubic-bezier(0.4,0,0.2,1), opacity 0.25s linear',
                      }}
                    />
                  );
                })}
                {/* Where the loop has got to, moving continuously rather than
                    jumping a segment at a time. Driven from the animation clock
                    on the compositor, so it costs nothing per frame. */}
                <span aria-hidden="true" ref={sweepRef} style={{
                  position: 'absolute', left: 0, right: 0, bottom: -4, height: 1.5,
                  background: 'rgba(56,189,248,0.55)', borderRadius: 1,
                  transformOrigin: 'left center', transform: 'scaleX(0)',
                  pointerEvents: 'none',
                }} />

                {/* Where observation ends and forecast begins — one hairline
                    instead of an outlined segment. */}
                {observedCount > 0 && observedCount < frames.length && (
                  <span aria-hidden="true" style={{
                    position: 'absolute', top: -3, bottom: -3, pointerEvents: 'none',
                    left: `${(observedCount / frames.length) * 100}%`,
                    width: 1, background: 'rgba(248,250,252,0.5)',
                  }} />
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, color: 'rgba(148,163,184,0.7)', fontSize: 9 }}>
                <span>{frames[0] ? new Date(frames[0].time * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                <span>{frames.at(-1) ? new Date(frames.at(-1).time * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
