/* Model Data: the frames between two model steps, for smooth GIFs and videos.

   A model gives a field every hour or so; played as they are, rain jumps from place to place. A
   plain cross-fade is no better: the old rain fades out where it was while the new rain fades in
   where it is. So the motion between the two steps is measured and the in-between frame moves both
   along it to where the weather would be at that moment, and only then blends the two:

     out(x, t) = (1 - t) A(x - t F(x)) + t B(x + (1 - t) F(x))

   t = 0 gives A and t = 1 gives B exactly, so every real model frame is shown as it is, and growth
   and decay between the two blend away smoothly. Everything happens on the VALUES (the frames'
   encoded bytes), before colouring, so a stepped colour scale keeps its crisp bands.

   Moving is not enough on its own. A model's showers do not match one for one from hour to hour,
   so a blend always softens them: the reds and yellows sink at every in-between frame and return at
   every real one, and the rain visibly pulses with the model's steps. So each in-between frame then
   has its values remapped to have the mix of intensities that lies between A's and B's (matching
   the quantiles, the "probability matching" of radar nowcasting): the same pattern, with the peaks
   and the rain area it should have.

   The motion F: first block matching on a small copy of the field, which finds the big moves (a
   shower can travel further than its own width between steps, and then gradients alone cannot see
   it go), then pyramidal Lucas-Kanade from there. At each level both frames are warped halfway
   towards each other by the motion so far (so F belongs to the middle of the step, where it is
   used), the leftover motion is solved in windows, and the answer is spread by a confidence-weighted
   blur, since only where there is structure can motion be seen at all. Weather moves with a broad
   steering flow, so a very smooth F is what is wanted.

   How each kind of field moves:
     advect   rain, cloud, fog, wind, pressure and everything else carried along: as above
     blend    running totals and fields tied to the ground (a total does not move; temperature
              over land and sea changes where it is; fog forms and clears where it lies, and moving
              it tested worse than leaving it): values blended where they stand
     category weather type and rain type: moved as above, the code switching halfway (a code cannot
              be averaged)
     angle    wind and wave direction: turned the short way round

   No DOM here, so the sums can be tested on real frames in Node. */

/* one frame's bytes: 0..254 are values, 255 is no data */
const NONE = 255;

/* fields that are carried along by the flow; the rest (lib/modelViewer scale keys) stay put */
const ADVECT = new Set(['precip_rate', 'rain_rate', 'snow_rate', 'conv_rain', 'hail_rate', 'precip_1h', 'rain_1h', 'snow_1h', 'hail_1h', 'radar', 'refc',
  'lightning', 'tcc', 'lcc', 'mcc', 'hcc', 'conv_cloud', 'cloud_1000ft', 'cloud_base', 'mslp', 'z500', 'z850', 'thick', 'wind10',
  'gust10', 'gust_max', 'wind100', 'wind925', 'wind850', 'wind700', 'wind500', 'wind300', 'wind250', 't925', 't850', 't700', 't500', 'wbpt850', 'rh700',
  'rh850', 'w700', 'vort500', 'pw', 'cape_mu', 'cape_sb', 'cape_ml', 'cin_sb', 'cin_mu', 'cin_ml', 'li', 'kindex', 'srh3', 'swh', 'pp1d', 'mwp', 'olr',
  'prob', 'dust_aod', 'aod', 'pm10', 'pm25']);
const CATEGORY = new Set(['wx', 'ptype', 'radar_type']);
const ANGLE = new Set(['wdir10', 'mwd']);
/** How a field moves between two steps: 'advect', 'blend', 'category' or 'angle'. */
export const tweenKind = (key) => (ANGLE.has(key) ? 'angle' : CATEGORY.has(key) ? 'category' : ADVECT.has(key) ? 'advect' : 'blend');
/* fields where no data means "none of it here" at the far end of the scale: fog that clears is not a
   hole in the map but visibility rising past the top of the scale, so it thins away through the
   colours; the byte it counts as */
const FILL = { fog_vis: 254 };

/* ── the motion ───────────────────────────────────────────────────────────── */
/* the typical byte of two frames: what no data counts as while the motion is measured, so the edge
   of the model's domain is not mistaken for a wall of weather that never moves */
function meanByte(qa, qb) {
  let s = 0, n = 0;
  for (let i = 0; i < qa.length; i += 7) {
    if (qa[i] !== NONE) { s += qa[i]; n++; }
    if (qb[i] !== NONE) { s += qb[i]; n++; }
  }
  return n ? s / n : 0;
}
/* a field shrunk by whole cells; no data counts as `fill` */
function shrink(q, W, H, s, fill) {
  const w = Math.max(2, Math.floor(W / s)), h = Math.max(2, Math.floor(H / s));
  const o = new Float32Array(w * h), n = 1 / (s * s);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let j = 0; j < s; j++) {
        const row = (y * s + j) * W + x * s;
        for (let i = 0; i < s; i++) { const v = q[row + i]; sum += v === NONE ? fill : v; }
      }
      o[y * w + x] = sum * n;
    }
  }
  return { a: o, w, h };
}
function halve(f) {
  const { a, w, h } = f;
  const W = Math.max(1, w >> 1), H = Math.max(1, h >> 1), o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * 2 * w + x * 2;
      o[y * W + x] = (a[i] + a[i + 1] + a[i + w] + a[i + w + 1]) * 0.25;
    }
  }
  return { a: o, w: W, h: H };
}
function bilinear(a, w, h, x, y) {
  if (x < 0) x = 0; else if (x > w - 1.001) x = w - 1.001;
  if (y < 0) y = 0; else if (y > h - 1.001) y = h - 1.001;
  const x0 = x | 0, y0 = y | 0, dx = x - x0, dy = y - y0, i = y0 * w + x0;
  return (a[i] * (1 - dx) + a[i + 1] * dx) * (1 - dy) + (a[i + w] * (1 - dx) + a[i + w + 1] * dx) * dy;
}
/* separable box blur, in place through `tmp` */
function box(a, w, h, r, tmp) {
  const n = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = a[row] * (r + 1);
    for (let i = 1; i <= r; i++) s += a[row + Math.min(i, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s * n;
      s += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = tmp[x] * (r + 1);
    for (let i = 1; i <= r; i++) s += tmp[Math.min(i, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      a[y * w + x] = s * n;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}
const blur = (a, w, h, r, tmp, passes = 2) => { for (let i = 0; i < passes; i++) box(a, w, h, r, tmp); };

function refine(A, B, U, V, w, h, win, spread, lamK = 0.02) {
  const n = w * h;
  const wa = new Float32Array(n), wb = new Float32Array(n);
  const xx = new Float32Array(n), xy = new Float32Array(n), yy = new Float32Array(n), xt = new Float32Array(n), yt = new Float32Array(n);
  const tmp = new Float32Array(n), conf = new Float32Array(n);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const u = U[i] * 0.5, v = V[i] * 0.5;
      wa[i] = bilinear(A, w, h, x - u, y - v);
      wb[i] = bilinear(B, w, h, x + u, y + v);
    }
  }
  for (let y = 0, i = 0; y < h; y++) {
    const up = y ? -w : 0, dn = y < h - 1 ? w : 0;
    for (let x = 0; x < w; x++, i++) {
      const l = x ? -1 : 0, r = x < w - 1 ? 1 : 0;
      const gx = (wa[i + r] - wa[i + l] + wb[i + r] - wb[i + l]) * 0.25;
      const gy = (wa[i + dn] - wa[i + up] + wb[i + dn] - wb[i + up]) * 0.25;
      const gt = wb[i] - wa[i];
      xx[i] = gx * gx; xy[i] = gx * gy; yy[i] = gy * gy; xt[i] = gx * gt; yt[i] = gy * gt;
    }
  }
  for (const f of [xx, xy, yy, xt, yt]) blur(f, w, h, win, tmp);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += xx[i] + yy[i];
  mean /= n;
  const lam = lamK * mean + 1e-3;                        // keeps weak texture from claiming big motions
  for (let i = 0; i < n; i++) {
    const a = xx[i] + lam, b = xy[i], c = yy[i] + lam, det = a * c - b * b;
    let du = -(c * xt[i] - b * yt[i]) / det, dv = -(a * yt[i] - b * xt[i]) / det;
    const m = Math.hypot(du, dv);
    if (m > 2.5) { du *= 2.5 / m; dv *= 2.5 / m; }       // never trust more than a little per pass
    U[i] += du; V[i] += dv;
    conf[i] = xx[i] + yy[i];
  }
  /* where there is structure the answer stands; elsewhere it comes from the structure around it */
  const nu = new Float32Array(n), nv = new Float32Array(n), dn = new Float32Array(n);
  for (let i = 0; i < n; i++) { nu[i] = U[i] * conf[i]; nv[i] = V[i] * conf[i]; dn[i] = conf[i]; }
  blur(nu, w, h, spread, tmp); blur(nv, w, h, spread, tmp); blur(dn, w, h, spread, tmp);
  const eps = 0.01 * mean + 1e-6;
  for (let i = 0; i < n; i++) { U[i] = nu[i] / (dn[i] + eps); V[i] = nv[i] / (dn[i] + eps); }
}

/* Block matching on a small copy: for tiles with something in them, the shift of the next frame that
   fits best, kept where it fits clearly better than no shift and placed half-way along it. Gives
   the level's starting motion, spread out by how good each fit was. */
function blockMotion(A, B, w, h) {
  const T = 5, half = 6, reach = Math.max(4, Math.round(Math.min(w, h) * 0.24));
  const u = new Float32Array(w * h), v = new Float32Array(w * h), c = new Float32Array(w * h), tmp = new Float32Array(w * h);
  let mean = 0;
  for (let i = 0; i < A.length; i++) mean += A[i];
  mean /= A.length;
  let spread = 0;
  for (let i = 0; i < A.length; i++) spread += (A[i] - mean) ** 2;
  spread /= A.length;
  for (let ty = half; ty < h - half; ty += T) {
    for (let tx = half; tx < w - half; tx += T) {
      let s1 = 0, s2 = 0, n = 0;
      for (let y = ty - half; y <= ty + half; y += 2) for (let x = tx - half; x <= tx + half; x += 2) { const a = A[y * w + x]; s1 += a; s2 += a * a; n++; }
      const texture = s2 / n - (s1 / n) ** 2;
      if (texture < 0.05 * spread + 1e-3) continue;
      let best = Infinity, bx = 0, by = 0, still = 0;
      for (let dy = -reach; dy <= reach; dy++) {
        const y0 = ty - half + dy, y1 = ty + half + dy;
        if (y0 < 0 || y1 >= h) continue;
        for (let dx = -reach; dx <= reach; dx++) {
          const x0 = tx - half + dx, x1 = tx + half + dx;
          if (x0 < 0 || x1 >= w) continue;
          let e = 0;
          for (let y = ty - half; y <= ty + half; y += 2) {
            const ra = y * w, rb = (y + dy) * w + dx;
            for (let x = tx - half; x <= tx + half; x += 2) { const d = A[ra + x] - B[rb + x]; e += d * d; }
            if (e > best) break;
          }
          e = e / n + (dx * dx + dy * dy) * 0.002 * texture;   // of two equal fits, the shorter move
          if (!dx && !dy) still = e;
          if (e < best) { best = e; bx = dx; by = dy; }
        }
      }
      if (best >= still * 0.8) continue;                 // no clear move here
      const px = Math.max(0, Math.min(w - 1, Math.round(tx + bx / 2))), py = Math.max(0, Math.min(h - 1, Math.round(ty + by / 2))), i = py * w + px;
      const weight = Math.max(1e-3, still - best);
      u[i] += bx * weight; v[i] += by * weight; c[i] += weight;
    }
  }
  blur(u, w, h, 4, tmp, 3); blur(v, w, h, 4, tmp, 3); blur(c, w, h, 4, tmp, 3);
  let top = 0;
  for (let i = 0; i < c.length; i++) if (c[i] > top) top = c[i];
  const eps = 0.02 * top + 1e-9;
  for (let i = 0; i < c.length; i++) { u[i] /= c[i] + eps; v[i] /= c[i] + eps; }
  return { u, v };
}

/** The motion from frame bytes `qa` to `qb` (each W x H): { u, v, w, h, s }, in cells of the full
    field per step, on a grid `s` times coarser. */
export function measureFlow(qa, qb, W, H, { fill = meanByte(qa, qb), target = 220, win = 4, spread = 7, spreadTop = 3, iters = 3, lam = 0.02 } = {}) {
  const s = Math.max(1, Math.round(Math.max(W, H) / target));
  const levels = [{ A: shrink(qa, W, H, s, fill), B: shrink(qb, W, H, s, fill) }];
  while (Math.max(levels[levels.length - 1].A.w, levels[levels.length - 1].A.h) > 80) {
    const top = levels[levels.length - 1];
    levels.push({ A: halve(top.A), B: halve(top.B) });
  }
  let U = null, V = null, pw = 0, ph = 0;
  for (let l = levels.length - 1; l >= 0; l--) {
    const { A, B } = levels[l];
    const { w, h } = A;
    let u = new Float32Array(w * h), v = new Float32Array(w * h);
    if (!U) ({ u, v } = blockMotion(A.a, B.a, w, h));    // the smallest copy: the big moves
    else {                                               // the coarser answer, as a start
      for (let y = 0, i = 0; y < h; y++) {
        for (let x = 0; x < w; x++, i++) {
          const fx = ((x + 0.5) * pw) / w - 0.5, fy = ((y + 0.5) * ph) / h - 0.5;
          u[i] = bilinear(U, pw, ph, fx, fy) * (w / pw);
          v[i] = bilinear(V, pw, ph, fx, fy) * (h / ph);
        }
      }
    }
    for (let k = 0; k < iters; k++) refine(A.a, B.a, u, v, w, h, win, l === 0 ? spread : spreadTop, lam);
    U = u; V = v; pw = w; ph = h;
  }
  return { u: U, v: V, w: pw, h: ph, s: W / pw, sy: H / ph };
}

/* the motion at every cell of the field, from its coarse grid */
function denseFlow(F, W, H) {
  const U = new Float32Array(W * H), V = new Float32Array(W * H);
  const kx = F.w / W, ky = F.h / H;
  for (let y = 0, i = 0; y < H; y++) {
    const fy = (y + 0.5) * ky - 0.5;
    for (let x = 0; x < W; x++, i++) {
      const fx = (x + 0.5) * kx - 0.5;
      U[i] = bilinear(F.u, F.w, F.h, fx, fy) * F.s;
      V[i] = bilinear(F.v, F.w, F.h, fx, fy) * F.sy;
    }
  }
  return { U, V };
}

/* the last few pairs' motion, as a run plays through them once: a window's layer and what is laid
   over it each have their own, and a cap on the cells kept (a 1 km radar frame is four UKV frames) */
const flows = new Map();
const FLOW_CELLS = 16e6;
function flowOf(a, b, W, H, fill) {
  const hit = flows.get(a);
  if (hit && hit.b === b) return hit.flow;
  const flow = denseFlow(measureFlow(a.q, b.q, W, H, fill >= 0 ? { fill } : {}), W, H);
  flows.set(a, { b, flow, cells: W * H });
  let held = 0;
  for (const f of flows.values()) held += f.cells;
  for (const [k, f] of flows) {
    if (held <= FLOW_CELLS || flows.size <= 2) break;
    flows.delete(k);
    held -= f.cells;
  }
  return flow;
}

/* ── the frames between ───────────────────────────────────────────────────── */
/* value and coverage at a point: bilinear over the cells that have data. Returns the value, or -1
   where under half of the four corners' weight has data. */
function sample(q, W, H, x, y, fill) {
  if (x < 0) x = 0; else if (x > W - 1.001) x = W - 1.001;
  if (y < 0) y = 0; else if (y > H - 1.001) y = H - 1.001;
  const x0 = x | 0, y0 = y | 0, dx = x - x0, dy = y - y0, i = y0 * W + x0;
  const a = q[i], b = q[i + 1], c = q[i + W], d = q[i + W + 1];
  const w0 = (1 - dx) * (1 - dy), w1 = dx * (1 - dy), w2 = (1 - dx) * dy, w3 = dx * dy;
  if (a !== NONE && b !== NONE && c !== NONE && d !== NONE) return a * w0 + b * w1 + c * w2 + d * w3;
  if (fill >= 0) return (a === NONE ? fill : a) * w0 + (b === NONE ? fill : b) * w1 + (c === NONE ? fill : c) * w2 + (d === NONE ? fill : d) * w3;
  let s = 0, n = 0;
  if (a !== NONE) { s += a * w0; n += w0; }
  if (b !== NONE) { s += b * w1; n += w1; }
  if (c !== NONE) { s += c * w2; n += w2; }
  if (d !== NONE) { s += d * w3; n += w3; }
  return n >= 0.5 ? s / n : -1;
}
const nearest = (q, W, H, x, y) => q[Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)))];

/** Bytes of the moved-and-blended field at t (0..1). `fill` < 0: no data stays no data, the frame
    nearer in time deciding where only one has it; otherwise no data counts as that byte, and a
    result at that byte is no data again. `box` [x0, y0, x1, y1] limits the work to the cells in
    view; those outside stay no data. */
export function advect(qa, qb, W, H, U, V, t, fill = -1, box = null) {
  const out = new Uint8Array(W * H).fill(NONE), s = 1 - t, xm = W - 1.001, ym = H - 1.001;
  const X0 = box ? Math.max(0, box[0]) : 0, Y0 = box ? Math.max(0, box[1]) : 0, X1 = box ? Math.min(W, box[2]) : W, Y1 = box ? Math.min(H, box[3]) : H;
  for (let y = Y0; y < Y1; y++) {
    let i = y * W + X0;
    for (let x = X0; x < X1; x++, i++) {
      const u = U[i], v = V[i];
      let ax = x - t * u, ay = y - t * v, bx = x + s * u, by = y + s * v;
      if (ax < 0) ax = 0; else if (ax > xm) ax = xm;
      if (ay < 0) ay = 0; else if (ay > ym) ay = ym;
      if (bx < 0) bx = 0; else if (bx > xm) bx = xm;
      if (by < 0) by = 0; else if (by > ym) by = ym;
      const ai = ax | 0, aj = ay | 0, bi = bx | 0, bj = by | 0, p = aj * W + ai, q = bj * W + bi;
      const a0 = qa[p], a1 = qa[p + 1], a2 = qa[p + W], a3 = qa[p + W + 1];
      const b0 = qb[q], b1 = qb[q + 1], b2 = qb[q + W], b3 = qb[q + W + 1];
      if ((a0 | a1 | a2 | a3 | b0 | b1 | b2 | b3) === 0) { out[i] = 0; continue; }     // dry on both sides: most of the map
      let r;
      if (a0 !== NONE && a1 !== NONE && a2 !== NONE && a3 !== NONE && b0 !== NONE && b1 !== NONE && b2 !== NONE && b3 !== NONE) {
        const ar = ax - ai, as = ay - aj, br = bx - bi, bs = by - bj;
        const at = a0 + (a1 - a0) * ar, ab = a2 + (a3 - a2) * ar, bt = b0 + (b1 - b0) * br, bb = b2 + (b3 - b2) * br;
        r = (at + (ab - at) * as) * s + (bt + (bb - bt) * bs) * t;
      } else {
        const a = sample(qa, W, H, ax, ay, fill), b = sample(qb, W, H, bx, by, fill);
        if (a >= 0 && b >= 0) r = a * s + b * t;
        else if (a < 0 && b < 0) r = NONE;
        else if (a >= 0) r = t < 0.5 ? a : NONE;
        else r = t >= 0.5 ? b : NONE;
      }
      if (fill >= 0 && r >= fill - 0.5) r = NONE;
      out[i] = r >= 254.5 ? NONE : r + 0.5;
    }
  }
  return out;
}
function advectCategory(qa, qb, W, H, U, V, t) {
  const out = new Uint8Array(W * H), s = 1 - t, first = t < 0.5;
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      out[i] = first ? nearest(qa, W, H, x - t * U[i], y - t * V[i]) : nearest(qb, W, H, x + s * U[i], y + s * V[i]);
    }
  }
  return out;
}
function blendBytes(qa, qb, t, fill = -1) {
  const n = qa.length, out = new Uint8Array(n), s = 1 - t;
  for (let i = 0; i < n; i++) {
    let a = qa[i], b = qb[i];
    if (fill >= 0) {                                     // no data is the far end of the scale: it thins away
      if (a === NONE && b === NONE) { out[i] = NONE; continue; }
      if (a === NONE) a = fill;
      if (b === NONE) b = fill;
      const r = a * s + b * t;
      out[i] = r >= fill - 0.5 ? NONE : Math.round(r);
      continue;
    }
    out[i] = a === NONE ? (t >= 0.5 ? b : NONE) : b === NONE ? (t < 0.5 ? a : NONE) : Math.round(a * s + b * t);
  }
  return out;
}
/* directions, the short way round; the frames' table turns bytes into degrees and `lo`..`hi` back */
function blendAngles(a, b, t) {
  const n = a.q.length, out = new Uint8Array(n), T = a.table;
  const lo = T[0], hi = T[254], k = 254 / (hi - lo);
  for (let i = 0; i < n; i++) {
    const p = a.q[i], q = b.q[i];
    if (p === NONE || q === NONE) { out[i] = t < 0.5 ? p : q; continue; }
    const da = T[p], d = ((T[q] - da + 540) % 360) - 180;
    out[i] = Math.max(0, Math.min(254, Math.round((((da + t * d) % 360 + 360) % 360 - lo) * k)));
  }
  return out;
}

/* how many cells hold each byte (no data left out), in the box */
function histogram(q, W, box) {
  const n = new Float64Array(256);
  if (!box) { for (let i = 0; i < q.length; i++) n[q[i]]++; } else {
    for (let y = box[1]; y < box[3]; y++) { const row = y * W; for (let x = box[0]; x < box[2]; x++) n[q[row + x]]++; }
  }
  n[NONE] = 0;
  return n;
}
/* the byte (fractional, within its bin) at each of LEVELS quantiles */
const LEVELS = 2048;
function quantiles(hist) {
  const out = new Float32Array(LEVELS + 1);
  let total = 0;
  for (let b = 0; b < 255; b++) total += hist[b];
  if (!total) return null;
  let cum = 0, b = 0;
  for (let k = 0; k <= LEVELS; k++) {
    const want = (k / LEVELS) * total;
    while (b < 254 && cum + hist[b] < want) cum += hist[b++];
    out[k] = b + (hist[b] ? Math.min(1, (want - cum) / hist[b]) - 0.5 : 0);
  }
  return out;
}
/* A's and B's quantiles, once per pair and view */
const spreads = new Map();
function spreadsOf(a, b, W, box) {
  const key = box ? box.join() : '';
  const hit = spreads.get(a);
  if (hit && hit.b === b && hit.key === key) return hit;
  const out = { b, key, qa: quantiles(histogram(a.q, W, box)), qb: quantiles(histogram(b.q, W, box)) };
  spreads.set(a, out);
  if (spreads.size > 12) spreads.delete(spreads.keys().next().value);
  return out;
}
/** Remaps bytes `q` in place so their quantiles lie t of the way from `qa`'s to `qb`'s. */
export function matchSpread(q, W, box, qa, qb, t) {
  if (!qa || !qb) return q;
  const hist = histogram(q, W, box);
  let total = 0;
  for (let b = 0; b < 255; b++) total += hist[b];
  if (!total) return q;
  const lut = new Uint8Array(256);
  lut[NONE] = NONE;
  let cum = 0;
  for (let b = 0; b < 255; b++) {
    const k = ((cum + hist[b] / 2) / total) * LEVELS;     // this byte's middle, as a quantile
    cum += hist[b];
    const k0 = Math.min(LEVELS - 1, k | 0), f = k - k0;
    const va = qa[k0] + (qa[k0 + 1] - qa[k0]) * f, vb = qb[k0] + (qb[k0 + 1] - qb[k0]) * f;
    lut[b] = Math.max(0, Math.min(254, Math.round(va * (1 - t) + vb * t)));
  }
  const X0 = box ? box[0] : 0, Y0 = box ? box[1] : 0, X1 = box ? box[2] : W, Y1 = box ? box[3] : q.length / W;
  for (let y = Y0; y < Y1; y++) { const row = y * W; for (let x = X0; x < X1; x++) q[row + x] = lut[q[row + x]]; }
  return q;
}

/** The frame t (0..1) of the way from frame `a` to frame `b`, for the scale key `key`. Frames with
    no bytes to move (pictures) come back as a mix for lib/modelViewer's frameCanvas to dissolve;
    frames that do not match are not mixed and the nearer one is returned. `box` [x0, y0, x1, y1],
    cells of the frame, limits the work to what is in view (the cells outside are left empty). */
export function tweenFrame(a, b, t, key, box = null) {
  if (!a || !b) return a || b;
  if (t <= 0 || a === b) return a;
  if (t >= 1) return b;
  if (a.img || b.img) return { ...a, mix: { a, b, t } };
  const W = a.nx || a.head.nx, H = a.ny || a.head.ny;
  if (!a.q || !b.q || a.q.length !== b.q.length || a.q.length !== W * H) return t < 0.5 ? a : b;
  const kind = tweenKind(key);
  const fill = FILL[key] ?? -1;
  const view = box && [Math.max(0, box[0] | 0), Math.max(0, box[1] | 0), Math.min(W, Math.ceil(box[2])), Math.min(H, Math.ceil(box[3]))];
  if (view && (view[2] <= view[0] || view[3] <= view[1])) return t < 0.5 ? a : b;
  let q;
  if (kind === 'blend') q = blendBytes(a.q, b.q, t, fill);
  else if (kind === 'angle') q = blendAngles(a, b, t);
  else {
    const { U, V } = flowOf(a, b, W, H, fill);
    if (kind === 'category') q = advectCategory(a.q, b.q, W, H, U, V, t);
    else {
      q = advect(a.q, b.q, W, H, U, V, t, fill, view);
      const { qa, qb } = spreadsOf(a, b, W, view);
      matchSpread(q, W, view, qa, qb, t);
    }
  }
  return { ...a, q };
}
