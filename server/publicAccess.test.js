/** What a site reachable from the internet allows visitors: whose address a request carries, the
    counting behind the sign-in limits, and which server functions a visitor may run. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, exhausted, forget, functionAllowed, note } from './entityAccess.js';

const req = (ip, headers = {}) => ({ socket: { remoteAddress: ip }, headers });

test('the tunnel on this PC passes the visitor on: its header is believed', () => {
  assert.equal(clientIp(req('127.0.0.1', { 'cf-connecting-ip': '81.2.69.160' })), '81.2.69.160');
  assert.equal(clientIp(req('::1', { 'x-forwarded-for': '81.2.69.160, 10.0.0.1' })), '81.2.69.160');
  assert.equal(clientIp(req('127.0.0.1')), '127.0.0.1');
});

test('a device on the network cannot fake its address with a header', () => {
  assert.equal(clientIp(req('192.168.1.20', { 'cf-connecting-ip': '1.2.3.4' })), '192.168.1.20');
  assert.equal(clientIp(req('192.168.1.20', { 'x-forwarded-for': '1.2.3.4' })), '192.168.1.20');
});

test('failures are counted up to the limit, and forgiven on success', () => {
  const key = `test-${Math.random()}`;
  for (let i = 0; i < 4; i++) {
    assert.equal(exhausted('t', key, 5, 60e3), false);
    note('t', key);
  }
  note('t', key);
  assert.equal(exhausted('t', key, 5, 60e3), true, 'five failures: no more tries');
  forget('t', key);
  assert.equal(exhausted('t', key, 5, 60e3), false, 'forgotten: tries again');
});

test('visitors may run only the functions the pages call', () => {
  for (const name of ['getMetOfficeLocationWeather', 'getMetOfficeWarnings', 'historicalLightning', 'sendOutlookEmailAlert']) {
    assert.equal(functionAllowed(name), true, name);
  }
  for (const name of ['verifyDailyForecast', 'getMetOfficeForecast', 'tcmApiPing', 'aiForecastCache', 'nonsense']) {
    assert.equal(functionAllowed(name), false, name);
    assert.equal(functionAllowed(name, { admin: true }), true, `${name} (admin)`);
    assert.equal(functionAllowed(name, { local: true }), true, `${name} (this PC)`);
  }
});
