/** Owner-only auto-login: direct requests from this PC are trusted; anything
    arriving through a proxy/tunnel or from another host is not. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDirectLocalRequest } from './auth.js';

const req = (ip, headers = {}) => ({ socket: { remoteAddress: ip }, headers: { host: 'localhost:8787', ...headers } });

test('direct request on this PC is trusted', () => {
  assert.equal(isDirectLocalRequest(req('127.0.0.1')), true);
  assert.equal(isDirectLocalRequest(req('::1')), true);
});
test('other machines are refused', () => {
  assert.equal(isDirectLocalRequest(req('192.168.1.20')), false);
  assert.equal(isDirectLocalRequest(req('81.2.69.160')), false);
});
test('tunnels and proxies on loopback are refused', () => {
  for (const h of ['x-forwarded-for', 'forwarded', 'cf-connecting-ip', 'x-real-ip']) assert.equal(isDirectLocalRequest(req('127.0.0.1', { [h]: '1.2.3.4' })), false, h);
  assert.equal(isDirectLocalRequest(req('127.0.0.1', { host: 'myweatheruk.example.com' })), false);
});
