/**
 * The few things a visitor does that touch records they may not read, done here on the server.
 *
 *   POST /api/newsletter/subscribe  { email, name? }      a 6-digit code (and a link) by email
 *   POST /api/newsletter/verify     { id?, code }         the code confirms the subscription
 *   POST /api/access/check          { code }              is this access code (or the universal
 *                                                         key) good for the closed site?
 *   POST /api/access/send-code      { email }             email a person their own active code
 *
 * The newsletter popup and sign-up page, and the closed site's sign-in, used to do these in the
 * browser by reading the subscriber list and every access code (entityAccess.js now keeps those
 * to admins). Every route is rate-limited by address, and the access routes answer the same
 * whether or not an address is known, so nothing can be fished out of them.
 */
import crypto from 'node:crypto';
import db from './db.js';
import { sendEmail } from './integrations.js';
import { limited, clientIp } from './entityAccess.js';

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const H = 3600e3;
const CODE_TTL = 24 * H;
const sixDigits = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
const originOf = (req) => req.get('origin') || `${req.protocol}://${req.get('host')}`;
const tooMany = (res) => res.status(429).json({ error: 'Too many tries. Please wait a few minutes and try again.' });

export function mountPublicFlows(app) {
  /* ── newsletter ── */
  app.post('/api/newsletter/subscribe', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim().slice(0, 80);
    if (!EMAIL_RE.test(email) || email.length > 200) return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (limited('nl-ip', clientIp(req), 8, H) || limited('nl-email', email, 4, H)) return tooMany(res);
    const existing = db.list('NewsletterSubscriber', { query: { email } })[0];
    if (existing?.verified && !existing.unsubscribed) return res.json({ already: true });
    const code = sixDigits(), now = new Date().toISOString();
    const row = existing
      ? db.update('NewsletterSubscriber', existing.id, { verification_token: code, verified: false, subscribed_at: now, unsubscribed: false, ...(name ? { name } : {}) })
      : db.create('NewsletterSubscriber', {
        email, name: name || null, verified: false, verification_token: code,
        subscribed_at: now, weekly_summary: true, storm_alerts: true, unsubscribed: false,
      });
    const link = `${originOf(req)}/NewsletterSignup?verify=${code}&sub=${encodeURIComponent(row.id)}`;
    try {
      await sendEmail({
        to: email,
        subject: 'Your MyWeatherUK verification code',
        body: `Hi ${name || 'there'},\n\nYour code to confirm your MyWeatherUK newsletter subscription is:\n\n${code}\n\nEnter it on the page, or open this link:\n${link}\n\nIf you didn't ask for this, you can ignore this email.\n\n— MyWeatherUK`,
      });
    } catch (err) {
      console.warn('[newsletter] the verification email was not sent:', err.message);
    }
    res.json({ id: row.id });
  });

  app.post('/api/newsletter/verify', (req, res) => {
    const code = String(req.body?.code || '').replace(/\s/g, '');
    const id = req.body?.id ? String(req.body.id) : null;
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code.' });
    if (limited('nl-verify', clientIp(req), 20, H)) return tooMany(res);
    const row = id ? db.get('NewsletterSubscriber', id) : db.list('NewsletterSubscriber', { query: { verification_token: code } })[0];
    const fresh = row?.subscribed_at && Date.now() - Date.parse(row.subscribed_at) < CODE_TTL;
    if (!row || row.verification_token !== code || !fresh) return res.status(400).json({ error: 'That code is not right, or it has expired.' });
    db.update('NewsletterSubscriber', row.id, { verified: true, verified_at: new Date().toISOString(), verification_token: null });
    res.json({ ok: true });
  });

  /* ── the closed site's access codes ── */
  app.post('/api/access/check', (req, res) => {
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Please enter your access code.' });
    if (limited('access-check', clientIp(req), 12, 15 * 60e3)) return tooMany(res);
    const key = String(db.list('SiteSettings')[0]?.universal_access_key || '').trim().toUpperCase();
    if (key && code === key) return res.json({ ok: true, email: 'universal' });
    const match = db.list('SiteAccessCode').find((r) => String(r.code || '').toUpperCase() === code && r.is_active);
    res.json(match ? { ok: true, email: match.email } : { ok: false });
  });

  app.post('/api/access/send-code', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter your email address.' });
    if (limited('access-send-ip', clientIp(req), 6, H) || limited('access-send', email, 3, H)) return tooMany(res);
    const active = db.list('SiteAccessCode').find((r) => String(r.email || '').toLowerCase() === email && r.is_active);
    if (active) {
      try {
        await sendEmail({ to: email, subject: 'Your MyWeatherUK access code', body: `Your MyWeatherUK access code is:\n\n${active.code}\n\n— MyWeatherUK` });
      } catch (err) {
        console.warn('[access] the code email was not sent:', err.message);
      }
    }
    res.json({ ok: true });                                     // the same answer either way
  });
}
