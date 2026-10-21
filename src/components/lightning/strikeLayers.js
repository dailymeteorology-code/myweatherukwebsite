/* The Lightning page's two strike layers, both drawn on canvas in one pass:
     • dots     every strike, coloured and sized by its age (or one fixed colour)
     • density  strikes per 1000 km², a smooth field on an absolute scale
   Age is counted from a reference time the page supplies: now while live, the scrubber's time
   while a past day is being replayed (strikes after it are not drawn at all). */

/* ONE table drives the dot colours, sizes and the legend. Newer strikes are drawn larger as well
   as whiter, so age can be read without telling orange from red. */
export const AGE_BANDS = [
  { max: 2, color: '#ffffff', r: 4.2, label: '< 2 min' },
  { max: 5, color: '#fef08a', r: 3.6, label: '5 min' },
  { max: 10, color: '#facc15', r: 3.2, label: '10 min' },
  { max: 30, color: '#f97316', r: 2.9, label: '30 min' },
  { max: 60, color: '#ef4444', r: 2.7, label: '1 h' },
  { max: 180, color: '#e11d74', r: 2.5, label: '3 h' },
  { max: 360, color: '#a855f7', r: 2.4, label: '6 h' },
  { max: 720, color: '#6366f1', r: 2.3, label: '12 h' },
  { max: Infinity, color: '#64748b', r: 2.2, label: 'older' },
];
export function ageBand(t, ref) {
  const m = (ref - t) / 60000;
  for (let i = 0; i < AGE_BANDS.length; i += 1) if (m < AGE_BANDS[i].max) return i;
  return AGE_BANDS.length - 1;
}

export const DOT_COLOURS = [
  { id: 'age', label: 'By age' },
  { id: 'yellow', label: 'Yellow', hex: '#facc15' },
  { id: 'white', label: 'White', hex: '#ffffff' },
  { id: 'cyan', label: 'Cyan', hex: '#22d3ee' },
  { id: 'pink', label: 'Pink', hex: '#f472b6' },
  { id: 'red', label: 'Red', hex: '#ef4444' },
];

/** Strikes as plain records projected once at zoom 0; a redraw is one multiply-add per axis.
 *  `get()` returns { colour, light, ref, cutoff }. Clicks find the nearest dot within 8 px. */
export function makeDotLayer(L, get, onPick) {
  const Layer = L.Layer.extend({
    initialize() { this._pts = []; this._raf = 0; this._last = 0; },
    onAdd(map) {
      this._map = map;
      const pane = map.getPane('lxDots') || map.createPane('lxDots');
      pane.style.zIndex = 600; pane.style.pointerEvents = 'none';
      this._canvas = L.DomUtil.create('canvas', 'leaflet-zoom-hide');
      this._canvas.style.position = 'absolute';
      pane.appendChild(this._canvas);
      map.on('moveend zoomend resize viewreset', this._reset, this);
      map.on('click', this._click, this);
      this._reset();
    },
    onRemove(map) {
      map.off('moveend zoomend resize viewreset', this._reset, this);
      map.off('click', this._click, this);
      L.DomUtil.remove(this._canvas);
      cancelAnimationFrame(this._raf); this._raf = 0;
    },
    _rec(s) {
      const w = L.CRS.EPSG3857.latLngToPoint(L.latLng(s.lat, s.lon), 0);
      return { x: w.x, y: w.y, t: s.time, s };
    },
    setStrikes(list) { this._pts = list.map((s) => this._rec(s)); this.redraw(); return this; },
    addStrikes(list) { for (const s of list) this._pts.push(this._rec(s)); this.redraw(); return this; },
    /** Drop strikes older than t (a rolling window moving on). */
    dropBefore(t) {
      const n = this._pts.length;
      this._pts = this._pts.filter((p) => p.t >= t);
      if (this._pts.length !== n) this.redraw();
    },
    count() { return this._pts.length; },
    _reset() {
      if (!this._map) return;
      const size = this._map.getSize();
      const dpr = window.devicePixelRatio || 1;
      L.DomUtil.setPosition(this._canvas, this._map.containerPointToLayerPoint([0, 0]));
      this._canvas.width = size.x * dpr; this._canvas.height = size.y * dpr;
      this._canvas.style.width = `${size.x}px`; this._canvas.style.height = `${size.y}px`;
      this._draw();
    },
    /* Strikes can arrive many a second: repaint at most ~4 times a second, and on very busy days
       keep painting under about a tenth of the time. */
    redraw() {
      if (!this._map || this._raf) return;
      const wait = Math.max(0, Math.max(250, (this._cost || 0) * 10) - (performance.now() - this._last));
      const go = () => { this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); }); };
      if (wait) { this._raf = -1; setTimeout(() => { this._raf = 0; go(); }, wait); } else go();
    },
    _draw() {
      const map = this._map; if (!map) return;
      this._last = performance.now();
      const c = this._canvas, ctx = c.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      const W = c.width / dpr, H = c.height / dpr;
      const { colour, light, ref, cutoff } = get();
      const fixed = colour && colour !== 'age' ? DOT_COLOURS.find((o) => o.id === colour)?.hex : null;
      const paths = AGE_BANDS.map(() => new Path2D());
      const used = new Array(AGE_BANDS.length).fill(false);
      const scr = this._scr = [];
      const centre = map.getCenter();
      const w0 = L.CRS.EPSG3857.latLngToPoint(centre, 0);
      const c0 = map.latLngToContainerPoint(centre);
      const k = map.getZoomScale(map.getZoom(), 0);
      for (const p of this._pts) {
        if (cutoff != null && p.t > cutoff) continue;
        const x = (p.x - w0.x) * k + c0.x, y = (p.y - w0.y) * k + c0.y;
        if (x < -6 || y < -6 || x > W + 6 || y > H + 6) continue;
        const b = ageBand(p.t, ref);
        const r = AGE_BANDS[b].r;
        paths[b].moveTo(x + r, y);
        paths[b].arc(x, y, r, 0, Math.PI * 2);
        used[b] = true;
        scr.push(x, y, p);
      }
      for (let b = AGE_BANDS.length - 1; b >= 0; b -= 1) {         // oldest first, newest on top
        if (!used[b]) continue;
        ctx.fillStyle = fixed || AGE_BANDS[b].color;
        ctx.fill(paths[b]);
        if (light) { ctx.strokeStyle = 'rgba(15,23,42,0.55)'; ctx.lineWidth = 0.8; ctx.stroke(paths[b]); }
      }
      this._cost = performance.now() - this._last;
    },
    _click(e) {
      const scr = this._scr; if (!scr || !scr.length) return;
      const { x, y } = e.containerPoint;
      let best = null, bd = 64;
      for (let i = 0; i < scr.length; i += 3) {
        const dx = scr[i] - x, dy = scr[i + 1] - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = scr[i + 2]; }
      }
      if (best) onPick(best.s, e);
    },
  });
  return new Layer();
}

/* ── density ──────────────────────────────────────────────────────────────
   Each strike is splatted (bilinear) onto a half-resolution grid, blurred with three box passes
   (≈ a Gaussian) whose width is fixed on the ground (12 km, about one thunderstorm cell), and
   divided by each row's true ground area, giving strikes per 1000 km² — an absolute scale, so a
   colour means the same density at every zoom and on every day. */
const BANDWIDTH_KM = 12;
const DS = 2;
const SIGMA_MIN = 2.5, SIGMA_MAX = 26;
export const HEAT_STOPS = [
  { v: 0.15, r: 49, g: 46, b: 129, a: 0.00 },
  { v: 0.8, r: 67, g: 56, b: 202, a: 0.30 },
  { v: 3, r: 37, g: 99, b: 235, a: 0.45 },
  { v: 8, r: 14, g: 165, b: 233, a: 0.57 },
  { v: 20, r: 16, g: 185, b: 129, a: 0.66 },
  { v: 50, r: 250, g: 204, b: 21, a: 0.75 },
  { v: 120, r: 249, g: 115, b: 22, a: 0.83 },
  { v: 300, r: 239, g: 68, b: 68, a: 0.89 },
  { v: 800, r: 253, g: 224, b: 255, a: 0.94 },
];
const LUT = (() => {
  const N = 1024, lo = Math.log10(HEAT_STOPS[0].v), hi = Math.log10(HEAT_STOPS[HEAT_STOPS.length - 1].v);
  const lut = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i += 1) {
    const lv = lo + ((hi - lo) * i) / (N - 1), v = 10 ** lv;
    let a = HEAT_STOPS[0], b = HEAT_STOPS[HEAT_STOPS.length - 1];
    for (let k = 0; k < HEAT_STOPS.length - 1; k += 1) if (v >= HEAT_STOPS[k].v && v <= HEAT_STOPS[k + 1].v) { a = HEAT_STOPS[k]; b = HEAT_STOPS[k + 1]; break; }
    const la = Math.log10(a.v), lb = Math.log10(b.v), f = lb === la ? 0 : (lv - la) / (lb - la);
    lut[i * 4] = a.r + (b.r - a.r) * f; lut[i * 4 + 1] = a.g + (b.g - a.g) * f;
    lut[i * 4 + 2] = a.b + (b.b - a.b) * f; lut[i * 4 + 3] = 255 * (a.a + (b.a - a.a) * f);
  }
  return { lut, lo, hi, n: N };
})();
export const HEAT_GRADIENT = (() => {
  const lo = Math.log10(HEAT_STOPS[0].v), hi = Math.log10(HEAT_STOPS[HEAT_STOPS.length - 1].v);
  return `linear-gradient(90deg, ${HEAT_STOPS.map((s) => `rgba(${s.r},${s.g},${s.b},${Math.max(s.a, 0.12).toFixed(2)}) ${(((Math.log10(s.v) - lo) / (hi - lo)) * 100).toFixed(1)}%`).join(', ')})`;
})();
export const HEAT_TICKS = ['0.2', '3', '20', '120', '800'];

function blurH(src, dst, w, h, r) {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let acc = 0;
    for (let i = -r; i <= r; i += 1) acc += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x += 1) {
      dst[row + x] = acc * norm;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
}
function blurV(src, dst, w, h, r) {
  const norm = 1 / (2 * r + 1);
  for (let x = 0; x < w; x += 1) {
    let acc = 0;
    for (let i = -r; i <= r; i += 1) acc += src[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y += 1) {
      dst[y * w + x] = acc * norm;
      acc += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
    }
  }
}

export function makeHeatLayer(L) {
  const Heat = L.Layer.extend({
    initialize() { this._pts = []; },
    onAdd(map) {
      this._map = map;
      this._canvas = L.DomUtil.create('canvas', 'lx-heat');
      Object.assign(this._canvas.style, { position: 'absolute', pointerEvents: 'none', willChange: 'transform' });
      map.getPane('overlayPane').appendChild(this._canvas);
      map.on('moveend zoomend resize', this._reset, this);
      if (map.options.zoomAnimation && L.Browser.any3d) {
        L.DomUtil.addClass(this._canvas, 'leaflet-zoom-animated');
        map.on('zoomanim', this._zoom, this);
      }
      this._vis = () => { if (document.visibilityState === 'visible' && this._dirty) { this._dirty = false; this._reset(); } };
      document.addEventListener('visibilitychange', this._vis);
      this._reset();
    },
    onRemove(map) {
      map.off('moveend zoomend resize', this._reset, this);
      map.off('zoomanim', this._zoom, this);
      document.removeEventListener('visibilitychange', this._vis);
      clearTimeout(this._timer); this._timer = null;
      this._canvas?.remove(); this._canvas = null; this._map = null;
    },
    _zoom(e) {
      if (!this._canvas) return;
      const scale = this._map.getZoomScale(e.zoom);
      const offset = this._map._latLngBoundsToNewLayerBounds(this._map.getBounds(), e.zoom, e.center).min;
      L.DomUtil.setTransform(this._canvas, offset, scale);
    },
    setStrikes(list) { this._pts = list; this._reset(); return this; },
    addStrikes(list) { for (const s of list) this._pts.push(s); this._schedule(); return this; },
    dropBefore(t) { const n = this._pts.length; this._pts = this._pts.filter((s) => s.time >= t); if (n !== this._pts.length) this._schedule(); },
    /* a throttle, not a debounce: a busy storm never goes quiet, so a debounce would never draw */
    _schedule() {
      if (this._timer || !this._map) return;
      const gap = Math.min(4000, Math.max(600, (this._cost || 20) * 8));
      const wait = Math.max(0, (this._at || 0) + gap - performance.now());
      this._timer = setTimeout(() => {
        this._timer = null;
        if (document.visibilityState !== 'visible') { this._dirty = true; return; }
        this._reset();
      }, wait);
    },
    _reset() {
      const map = this._map, c = this._canvas;
      if (!map || !c) return;
      const size = map.getSize();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (c.width !== Math.round(size.x * dpr) || c.height !== Math.round(size.y * dpr)) { c.width = Math.round(size.x * dpr); c.height = Math.round(size.y * dpr); }
      c.style.width = `${size.x}px`; c.style.height = `${size.y}px`;
      L.DomUtil.setTransform(c, map.containerPointToLayerPoint([0, 0]), 1);
      const t0 = performance.now();
      this._draw(size, dpr);
      this._at = performance.now(); this._cost = this._at - t0;
    },
    _draw(size, dpr) {
      const map = this._map, ctx = this._canvas.getContext('2d');
      ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
      const cutoff = this.cutoff;
      const pts = cutoff != null ? this._pts.filter((s) => s.time <= cutoff) : this._pts;
      if (!pts.length) return;
      const gw = Math.max(2, Math.ceil(size.x / DS) + 1), gh = Math.max(2, Math.ceil(size.y / DS) + 1);
      const grid = new Float32Array(gw * gh);
      let any = false;
      for (const s of pts) {
        const p = map.latLngToContainerPoint([s.lat, s.lon]);
        const gx = p.x / DS, gy = p.y / DS;
        if (gx < -64 || gy < -64 || gx > gw + 64 || gy > gh + 64) continue;
        const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
        for (let dy = 0; dy <= 1; dy += 1) {
          const yy = y0 + dy; if (yy < 0 || yy >= gh) continue;
          const wy = dy ? fy : 1 - fy;
          for (let dx = 0; dx <= 1; dx += 1) {
            const xx = x0 + dx; if (xx < 0 || xx >= gw) continue;
            grid[yy * gw + xx] += wy * (dx ? fx : 1 - fx); any = true;
          }
        }
      }
      if (!any) return;
      const mPerPx = (156543.03392 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** map.getZoom();
      const nominal = (BANDWIDTH_KM * 1000) / mPerPx / DS;
      const sigma = Math.min(SIGMA_MAX, Math.max(SIGMA_MIN, nominal));
      const fix = (sigma / Math.max(nominal, 1e-6)) ** 2;          // report density at the nominal width however it was drawn
      const r = Math.max(1, Math.round((sigma * 2 + 1) / 2));
      const tmp = new Float32Array(gw * gh);
      for (let pass = 0; pass < 3; pass += 1) { blurH(grid, tmp, gw, gh, r); blurV(tmp, grid, gw, gh, r); }
      const img = ctx.createImageData(gw, gh), out = img.data;
      const { lut, lo, hi, n } = LUT, inv = (n - 1) / (hi - lo);
      for (let y = 0; y < gh; y += 1) {
        const lat = map.containerPointToLatLng([0, y * DS]).lat;
        const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** map.getZoom();
        const per1000 = 1000 / Math.max(((mpp * DS) / 1000) ** 2, 1e-9);
        const row = y * gw;
        for (let x = 0; x < gw; x += 1) {
          const v = grid[row + x] * per1000 * fix;
          if (v <= HEAT_STOPS[0].v) continue;
          let i = Math.round((Math.log10(v) - lo) * inv);
          if (i < 0) i = 0; else if (i >= n) i = n - 1;
          const o = (row + x) * 4, l = i * 4;
          out[o] = lut[l]; out[o + 1] = lut[l + 1]; out[o + 2] = lut[l + 2]; out[o + 3] = lut[l + 3];
        }
      }
      const off = document.createElement('canvas');
      off.width = gw; off.height = gh;
      off.getContext('2d').putImageData(img, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, gw, gh, 0, 0, gw * DS * dpr, gh * DS * dpr);
      ctx.restore();
    },
  });
  return new Heat();
}

/* ── live effects ─────────────────────────────────────────────────────────── */

/** An expanding ring where a strike has just landed (at most 8 at once, none in a hidden tab). */
let flashes = 0;
export function flashAt(L, layer, lat, lon) {
  if (!layer || document.visibilityState !== 'visible' || flashes >= 8) return;
  flashes += 1;
  const ring = L.circleMarker([lat, lon], { radius: 6, color: '#ffffff', fill: false, weight: 2, opacity: 0.95, interactive: false }).addTo(layer);
  const core = L.circleMarker([lat, lon], { radius: 2.5, color: '#facc15', fillColor: '#facc15', fillOpacity: 0.95, weight: 1, interactive: false }).addTo(layer);
  const t0 = performance.now();
  const step = () => {
    const t = (performance.now() - t0) / 1400;
    if (t >= 1) { layer.removeLayer(ring); layer.removeLayer(core); flashes -= 1; return; }
    const e = 1 - (1 - t) ** 2;
    ring.setRadius(6 + e * 26); ring.setStyle({ opacity: 0.9 * (1 - t) });
    core.setStyle({ opacity: Math.max(0, 1 - t * 2.5), fillOpacity: Math.max(0, 1 - t * 2.5) });
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** A short synthesised crack and rumble (Web Audio), for a strike landing in view. */
export function thunder(ctxRef) {
  try {
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') { ctx.resume(); return; }
    const now = ctx.currentTime;
    const out = ctx.createDynamicsCompressor();
    out.connect(ctx.destination);
    const noise = (dur, shape) => {
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i += 1) d[i] = (Math.random() * 2 - 1) * shape(i / d.length);
      const src = ctx.createBufferSource(); src.buffer = buf;
      return src;
    };
    const crack = noise(0.06, (x) => (1 - x) ** 1.4);
    const cf = ctx.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 1800; cf.Q.value = 0.4;
    const cg = ctx.createGain(); cg.gain.setValueAtTime(0.5, now); cg.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    crack.connect(cf); cf.connect(cg); cg.connect(out); crack.start(now);
    const rumble = noise(1.4, (x) => (1 - x) ** 2);
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 160;
    const rg = ctx.createGain(); rg.gain.setValueAtTime(0.0001, now); rg.gain.exponentialRampToValueAtTime(0.7, now + 0.08); rg.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
    rumble.connect(rf); rf.connect(rg); rg.connect(out); rumble.start(now + 0.02);
  } catch { /* no audio here */ }
}
