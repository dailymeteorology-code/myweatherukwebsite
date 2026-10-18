// node --test server/tcmNova.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-'));
process.env.NOVA_DATA = tmp;
const { nextMainCycle, nextHyperCycle, londonParts, mountTcmNova } = await import('./tcmNova.js');

const hm = (d) => { const p = londonParts(d); return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`; };

test('main cycles at 03/09/15/21 London time in BST and GMT', () => {
  assert.equal(hm(nextMainCycle(new Date('2026-07-01T10:00:00Z'))), '15:00');          // 11:00 BST -> 15:00
  assert.equal(nextMainCycle(new Date('2026-07-01T10:00:00Z')).toISOString(), '2026-07-01T14:00:00.000Z');
  assert.equal(nextMainCycle(new Date('2026-12-01T10:00:00Z')).toISOString(), '2026-12-01T15:00:00.000Z');
  const seen = []; let t = new Date('2026-07-01T00:00:00Z');
  for (let i = 0; i < 4; i += 1) { t = nextMainCycle(t); seen.push(hm(t)); }
  assert.deepEqual(seen, ['03:00', '09:00', '15:00', '21:00']);
});

test('main cycles across both DST transitions', () => {
  // spring forward 29 Mar 2026 01:00 UTC; fall back 25 Oct 2026 01:00 UTC
  assert.equal(nextMainCycle(new Date('2026-03-29T00:30:00Z')).toISOString(), '2026-03-29T02:00:00.000Z'); // 03:00 BST
  assert.equal(nextMainCycle(new Date('2026-10-25T00:30:00Z')).toISOString(), '2026-10-25T03:00:00.000Z'); // 03:00 GMT
});

test('learning runs at 00:00 London time in BST and GMT', () => {
  assert.equal(nextMainCycle(new Date('2026-07-01T12:00:00Z'), ['00:00']).toISOString(), '2026-07-01T23:00:00.000Z');
  assert.equal(nextMainCycle(new Date('2026-12-01T12:00:00Z'), ['00:00']).toISOString(), '2026-12-02T00:00:00.000Z');
});

test('hyper runs at the top of every London hour, 24 a day even on DST days', () => {
  let t = new Date('2026-10-25T00:10:00Z'); const runs = [];
  while (runs.length < 25) { t = nextHyperCycle(t); runs.push(t); }
  assert.ok(runs.every((r) => londonParts(r).mi === 0));
  assert.equal(new Set(runs.map((r) => r.getTime())).size, 25);
});

function fakeRun(product, id, horizon) {
  const dir = path.join(tmp, product, id);
  fs.mkdirSync(path.join(dir, 'frames', '0'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'frames', '0', 'p_thunder.bin'), zlib.deflateSync(Buffer.alloc(8)));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ run_id: id, product, status: 'published', horizon_h: horizon,
    init_utc: '2026-10-18T14:00:00Z', frames: [{ lead_min: 0, valid: 'x' }], fields: { p_thunder: 'float16' } }));
  fs.writeFileSync(path.join(tmp, product, 'latest.json'), JSON.stringify({ run_id: id }));
}

test('API keeps products apart and enforces the horizon', async () => {
  fakeRun('main', 'main-20261018T1400Z', 120);
  fakeRun('hyper', 'hyper-20261018T1500Z', 24);
  const routes = {};
  const app = { get: (p, h) => { routes[p] = h; } };
  mountTcmNova(app, { schedule: false });
  const call = (route, params) => new Promise((resolve) => {
    const res = { code: 200, headers: {}, status(c) { this.code = c; return this; }, set(h) { Object.assign(this.headers, h); return this; },
      json(b) { resolve({ code: this.code, body: b }); }, end() { resolve({ code: this.code }); }, on() {}, once() {}, emit() {}, write() {} };
    res.pipe = undefined;
    routes[route]({ params }, new Proxy(res, { get: (o, k) => (k in o ? o[k] : () => resolve({ code: o.code, stream: true })) }));
  });
  const latest = await call('/api/nova/:product/latest', { product: 'hyper' });
  assert.equal(latest.body.product, 'hyper');
  const cross = await call('/api/nova/:product/runs/:id', { product: 'hyper', id: 'main-20261018T1400Z' });
  assert.equal(cross.code, 404);                               // a Main run id under the Hyper product is refused
  const beyond = await call('/api/nova/:product/runs/:id/frame/:lead/:field', { product: 'hyper', id: 'hyper-20261018T1500Z', lead: String(25 * 60), field: 'p_thunder' });
  assert.equal(beyond.code, 416);                              // past T+24 h
  const bad = await call('/api/nova/:product/runs', { product: 'ukv' });
  assert.equal(bad.code, 400);
});
