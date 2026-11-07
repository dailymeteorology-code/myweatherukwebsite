/* The frames between two model steps (src/lib/modelTween.js): real frames must come through
   untouched, and what moves must move. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { measureFlow, matchSpread, tweenFrame, tweenKind } from '../src/lib/modelTween.js';

const W = 240, H = 200;
const frame = (q, table) => ({ head: { nx: W, ny: H }, q, table });
/* a soft-edged blob of rain, 24 cells wide */
function blob(cx, cy, top = 200) {
  const q = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy);
      q[y * W + x] = d < 12 ? Math.round(top * (1 - (d / 12) ** 2)) : 0;
    }
  }
  return q;
}
/* where a field's weight sits */
function centre(q) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = q[y * W + x]; if (v && v !== 255) { sx += x * v; sy += y * v; n += v; } }
  return [sx / n, sy / n];
}

test('the real frames at each end come back as they are', () => {
  const a = frame(blob(70, 100)), b = frame(blob(130, 100));
  assert.equal(tweenFrame(a, b, 0, 'precip_rate'), a);
  assert.equal(tweenFrame(a, b, 1, 'precip_rate'), b);
});

test('rain moves between the steps rather than fading from one place to the other', () => {
  /* further than its own width in one step, as a shower can go */
  const a = frame(blob(80, 100)), b = frame(blob(116, 100));
  for (const t of [0.25, 0.5, 0.75]) {
    const [cx] = centre(tweenFrame(a, b, t, 'precip_rate').q);
    assert.ok(Math.abs(cx - (80 + 36 * t)) < 5, `at ${t} the rain is at ${cx.toFixed(1)}`);
  }
  /* a plain cross-fade would leave nothing in the middle at the half-way point */
  const mid = tweenFrame(a, b, 0.5, 'precip_rate').q;
  assert.ok(mid[100 * W + 98] > 120, 'the core of the rain is half-way along at half time');
  assert.ok(mid[100 * W + 80] < 40 && mid[100 * W + 116] < 40, 'and is not still at either end');
});

test('the peaks stay as strong through the move', () => {
  const a = frame(blob(80, 100)), b = frame(blob(116, 100));
  const mid = tweenFrame(a, b, 0.5, 'precip_rate').q;
  assert.ok(Math.max(...mid) >= 170, `peak ${Math.max(...mid)} of 200`);
});

test('the motion is measured the right way round and at about the right size', () => {
  const F = measureFlow(blob(90, 100), blob(120, 110), W, H, { fill: 0 });
  const i = Math.round(F.h / 2) * F.w + Math.round(F.w * 0.44);
  assert.ok(Math.abs(F.u[i] * F.s - 30) < 8, `east ${F.u[i] * F.s}`);
  assert.ok(Math.abs(F.v[i] * F.sy - 10) < 8, `south ${F.v[i] * F.sy}`);
});

test('a running total does not move, it only grows where it is', () => {
  const a = frame(blob(70, 100, 100)), b = frame(blob(130, 100, 100));
  assert.equal(tweenKind('precip_total'), 'blend');
  const mid = tweenFrame(a, b, 0.5, 'precip_total').q;
  assert.equal(mid[100 * W + 70], 50);
  assert.equal(mid[100 * W + 130], 50);
  assert.equal(mid[100 * W + 100], 0);
});

test('fog thins away where it clears, without a hole or a jump', () => {
  const none = new Uint8Array(W * H).fill(255);
  const fog = new Uint8Array(W * H).fill(255);
  fog[50 * W + 50] = 40;
  const a = frame(fog), b = frame(none);
  assert.equal(tweenFrame(a, b, 0.25, 'fog_vis').q[50 * W + 50], 94);        // 40 thinning towards 254
  assert.equal(tweenFrame(a, b, 0.75, 'fog_vis').q[50 * W + 50], 201);
  assert.equal(tweenFrame(a, b, 0.5, 'fog_vis').q[0], 255);                  // clear stays clear
});

test('a weather code never becomes the average of two codes', () => {
  const a = new Uint8Array(W * H).fill(2), b = new Uint8Array(W * H).fill(8);
  const q = tweenFrame(frame(a), frame(b), 0.4, 'wx').q;
  assert.equal(new Set(q).size, 1);
  assert.equal(q[0], 2);
  assert.equal(tweenFrame(frame(a), frame(b), 0.6, 'wx').q[0], 8);
});

test('a wind direction turns the short way round', () => {
  const table = new Float32Array(256);
  for (let i = 0; i < 255; i++) table[i] = (i / 254) * 360;
  table[255] = NaN;
  const byte = (deg) => Math.round((deg / 360) * 254);
  const q = tweenFrame(frame(new Uint8Array(W * H).fill(byte(350)), table), frame(new Uint8Array(W * H).fill(byte(10)), table), 0.5, 'wdir10').q;
  const deg = table[q[0]];
  assert.ok(deg < 3 || deg > 357, `350 to 10 goes through north, not ${deg}`);
});

test('a picture is left for the canvas to dissolve', () => {
  const a = { head: {}, img: {} }, b = { head: {}, img: {} };
  assert.deepEqual(tweenFrame(a, b, 0.3, 'sat_ir').mix, { a, b, t: 0.3 });
});

test('only the cells in view are worked out', () => {
  const a = frame(blob(80, 100)), b = frame(blob(116, 100));
  const q = tweenFrame(a, b, 0.5, 'precip_rate', [80, 60, 120, 140]).q;
  assert.equal(q[10 * W + 10], 255);
  assert.ok(q[100 * W + 98] > 100);
});

test('frames that do not match are not mixed', () => {
  const a = frame(blob(70, 100));
  const b = { head: { nx: 10, ny: 10 }, q: new Uint8Array(100) };
  assert.equal(tweenFrame(a, b, 0.2, 'precip_rate'), a);
  assert.equal(tweenFrame(a, b, 0.8, 'precip_rate'), b);
});

test('matching the spread gives the values their in-between mix', () => {
  const q = new Uint8Array(W * H);
  const qa = new Float32Array(2049), qb = new Float32Array(2049);
  for (let k = 0; k <= 2048; k++) { qa[k] = (k / 2048) * 100; qb[k] = (k / 2048) * 200; }
  for (let i = 0; i < q.length; i++) q[i] = i % 100;
  const out = matchSpread(q.slice(), W, null, qa, qb, 0.5);
  assert.ok(Math.abs(Math.max(...out) - 149) < 3, `top ${Math.max(...out)}`);
});
