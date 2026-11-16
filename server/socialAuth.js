/**
 * Sign in or sign up with Apple or Google (mounted under /api/auth by auth.js).
 *
 *   GET  /providers        which buttons work: { apple, google }
 *   POST /apple            { identityToken, fullName? } from Sign in with Apple in the iPhone app
 *   GET  /google/start     ?next=/path (the website) or ?app=<the app's return address>
 *   GET  /google/callback  Google's answer: a session, handed back in the address
 *
 * Apple: the app gets an identity token from Apple's own sheet; it is a JWT signed by Apple, checked
 * here against Apple's published keys, for this app (APPLE_AUDIENCES: the app's bundle id, and Expo
 * Go's while testing). Google: the standard sign-in with the site's own Google client
 * (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) and SITE_URL, the site's public https address, which Google
 * sends people back to. Google refuses sign-in inside an app's web view, so the app opens it in the
 * phone's secure sign-in sheet and is given the session through its own address (myweatheruk://).
 *
 * An Apple or Google account joins the site's account with the same (verified) email, so one person
 * keeps one account whichever way they sign in. A sign-up never verified by email is taken over by the
 * owner of that address: its password, never proven, is replaced. New accounts are ordinary users.
 */
import crypto from 'node:crypto';
import express from 'express';
import db from './db.js';
import { publicUser } from './base44Server.js';
import { clientIp, limited } from './entityAccess.js';

const APPLE_KEYS = 'https://appleid.apple.com/auth/keys';
const GOOGLE_KEYS = 'https://www.googleapis.com/oauth2/v3/certs';
const MIN15 = 15 * 60e3;
const TOO_MANY = 'Too many attempts. Please wait a few minutes and try again.';

const env = (k) => String(process.env[k] || '').trim();
const appleAudiences = () => (env('APPLE_AUDIENCES') || 'com.myweatheruk.app,host.exp.Exponent').split(',').map((s) => s.trim()).filter(Boolean);
const siteUrl = () => env('SITE_URL').replace(/\/+$/, '');
const googleReady = () => !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET') && /^https:\/\//.test(siteUrl()));

/* ── checking a provider's signed token (RS256 JWTs, against the provider's published keys) ── */
const keyCache = new Map();                                  // url -> { at, keys }
async function keysOf(url, force = false) {
  const hit = keyCache.get(url);
  if (!force && hit && Date.now() - hit.at < 6 * 3600e3) return hit.keys;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`could not fetch the sign-in keys (${r.status})`);
  const keys = (await r.json()).keys || [];
  keyCache.set(url, { at: Date.now(), keys });
  return keys;
}
const part = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

export async function verifyIdToken(token, { keysUrl, issuers, audiences }) {
  const bits = String(token || '').split('.');
  if (bits.length !== 3) throw new Error('not a sign-in token');
  const [h, p, sig] = bits;
  const header = part(h), claims = part(p);
  if (header.alg !== 'RS256') throw new Error('unexpected token signature');
  let jwk = (await keysOf(keysUrl)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await keysOf(keysUrl, true)).find((k) => k.kid === header.kid);   // the provider rotated its keys
  if (!jwk) throw new Error('unknown signing key');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url'));
  if (!ok) throw new Error('the token signature is not valid');
  const now = Date.now() / 1000;
  if (!issuers.includes(claims.iss)) throw new Error('the token is from someone else');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.some((a) => audiences.includes(a))) throw new Error('the token is for another app');
  if (!(claims.exp > now - 60)) throw new Error('the token has expired');
  return claims;
}

/* ── one account per person ── */
function newPassword(hashPassword) {
  const { hash, salt } = hashPassword(crypto.randomBytes(24).toString('hex'));
  return { password_hash: hash, password_salt: salt };
}
export function accountFor(provider, { sub, email, emailVerified, name }, hashPassword) {
  const field = `${provider}_sub`;
  const mail = String(email || '').trim().toLowerCase();
  let user = db.findUser((u) => u[field] === sub);
  if (!user && mail && emailVerified) user = db.findUserByEmail(mail);
  if (user) {
    const patch = { [field]: sub };
    if (!user.verified) Object.assign(patch, { verified: true, otp_code: null, otp_expires: null }, newPassword(hashPassword));
    db.updateUser(user.id, patch);
    return db.findUserById(user.id);
  }
  if (!mail) throw new Error(`${provider === 'apple' ? 'Apple' : 'Google'} did not share an email address.`);
  return db.createUser({
    email: mail, full_name: (name || '').trim() || mail.split('@')[0], role: 'user', verified: true,
    [field]: sub, ...newPassword(hashPassword),
  });
}

/* ── Google's sign-in: the round trip's state, kept briefly here ── */
const pending = new Map();                                   // state -> { next, app, at }
const APP_RETURN = /^(myweatheruk:\/\/|exp:\/\/)[^\s]{0,300}$/i;
function remember(entry) {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.at > 10 * 60e3) pending.delete(k);
  const state = crypto.randomBytes(24).toString('hex');
  pending.set(state, { ...entry, at: now });
  return state;
}
const withParams = (base, params, fragment) => `${base}${fragment ? '#' : base.includes('?') ? '&' : '?'}${new URLSearchParams(params)}`;

export function socialRoutes({ hashPassword, sessionTtlMs }) {
  const router = express.Router();
  const signIn = (user) => ({ access_token: db.createSession(user.id, sessionTtlMs), user: publicUser(user) });

  router.get('/providers', (req, res) => res.json({ apple: true, google: googleReady() }));

  router.post('/apple', async (req, res) => {
    if (limited('apple-ip', clientIp(req), 20, MIN15)) return res.status(429).json({ error: TOO_MANY });
    try {
      const claims = await verifyIdToken(req.body?.identityToken, {
        keysUrl: APPLE_KEYS, issuers: ['https://appleid.apple.com'], audiences: appleAudiences(),
      });
      const fn = req.body?.fullName || {};
      const name = [fn.givenName, fn.familyName].filter(Boolean).join(' ');
      const user = accountFor('apple', { sub: claims.sub, email: claims.email, emailVerified: String(claims.email_verified) !== 'false', name }, hashPassword);
      console.log(`[auth] Apple sign-in: ${user.email}`);
      res.json(signIn(user));
    } catch (err) {
      console.warn(`[auth] Apple sign-in refused: ${err.message}`);
      res.status(401).json({ error: `Apple sign-in did not work: ${err.message}` });
    }
  });

  router.get('/google/start', (req, res) => {
    if (!googleReady()) return res.status(503).send('Google sign-in is not set up on this site.');
    if (limited('google-ip', clientIp(req), 20, MIN15)) return res.status(429).send(TOO_MANY);
    const app = typeof req.query.app === 'string' && APP_RETURN.test(req.query.app) ? req.query.app : null;
    const nextRaw = String(req.query.next || '/');
    const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/';
    const state = remember({ next, app });
    res.redirect(withParams('https://accounts.google.com/o/oauth2/v2/auth', {
      client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: `${siteUrl()}/api/auth/google/callback`, response_type: 'code',
      scope: 'openid email profile', state, prompt: 'select_account',
    }));
  });

  router.get('/google/callback', async (req, res) => {
    const entry = pending.get(String(req.query.state || ''));
    pending.delete(String(req.query.state || ''));
    if (!entry) return res.status(400).send('That sign-in has expired. Please try again.');
    const back = (params) => res.redirect(entry.app ? withParams(entry.app, params, false) : withParams(`${siteUrl()}${entry.next}`, params, true));
    if (req.query.error) return back(entry.app ? { error: String(req.query.error) } : { mwuk_error: String(req.query.error) });
    try {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(req.query.code || ''), client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'),
          redirect_uri: `${siteUrl()}/api/auth/google/callback`, grant_type: 'authorization_code',
        }),
      });
      const tokens = await r.json().catch(() => ({}));
      if (!r.ok || !tokens.id_token) throw new Error(tokens.error_description || tokens.error || `Google answered ${r.status}`);
      const claims = await verifyIdToken(tokens.id_token, {
        keysUrl: GOOGLE_KEYS, issuers: ['https://accounts.google.com', 'accounts.google.com'], audiences: [env('GOOGLE_CLIENT_ID')],
      });
      const user = accountFor('google', { sub: claims.sub, email: claims.email, emailVerified: claims.email_verified === true || claims.email_verified === 'true', name: claims.name }, hashPassword);
      console.log(`[auth] Google sign-in: ${user.email}`);
      const { access_token } = signIn(user);
      return back(entry.app ? { token: access_token } : { mwuk_token: access_token });
    } catch (err) {
      console.warn(`[auth] Google sign-in refused: ${err.message}`);
      return back(entry.app ? { error: err.message } : { mwuk_error: err.message });
    }
  });

  return router;
}
