/** Apple and Google sign-in tokens: only a token signed with the provider's key, from the provider, for
    this app, and not expired, is believed. (A key pair made here stands in for the provider's.) */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyIdToken } from './socialAuth.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(claims, { kid = 'k1', key = privateKey } = {}) {
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' }), body = b64(claims);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${sig}`;
}
const keysUrl = `https://keys.test/${Math.random()}`;
globalThis.fetch = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
const opts = { keysUrl, issuers: ['https://appleid.apple.com'], audiences: ['com.myweatheruk.app'] };
const now = () => Math.floor(Date.now() / 1000);
const good = () => ({ iss: 'https://appleid.apple.com', aud: 'com.myweatheruk.app', sub: '001.abc', email: 'a@b.com', exp: now() + 600 });

test('a genuine token for this app is believed', async () => {
  const claims = await verifyIdToken(sign(good()), opts);
  assert.equal(claims.sub, '001.abc');
});

test('a token for another app, from someone else, or expired is refused', async () => {
  await assert.rejects(verifyIdToken(sign({ ...good(), aud: 'com.other.app' }), opts), /another app/);
  await assert.rejects(verifyIdToken(sign({ ...good(), iss: 'https://evil.example' }), opts), /someone else/);
  await assert.rejects(verifyIdToken(sign({ ...good(), exp: now() - 3600 }), opts), /expired/);
});

test('a forged or altered token is refused', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(verifyIdToken(sign(good(), { key: other }), opts), /signature/);
  const [h, , s] = sign(good()).split('.');
  await assert.rejects(verifyIdToken(`${h}.${b64({ ...good(), sub: 'someone-else' })}.${s}`, opts), /signature/);
  await assert.rejects(verifyIdToken(sign(good(), { kid: 'nope' }), opts), /unknown signing key/);
  await assert.rejects(verifyIdToken('not.a.token.at.all', opts));
});
