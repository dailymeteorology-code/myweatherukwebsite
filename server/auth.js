/**
 * Local accounts, replacing Base44's hosted auth.
 *
 * The Login / Register / ForgotPassword / ResetPassword pages are unchanged
 * copies of the Base44 export, so this implements exactly the flow they drive:
 * register -> emailed 6-digit code -> verify -> session token. With no mail
 * service configured the code is printed to the server console instead, which
 * is the right trade for a site serving one operator on one machine.
 *
 * Passwords are scrypt-hashed with a per-user salt. Session tokens are opaque
 * random strings kept in the JSON store; nothing is signed, because nothing
 * outside this process ever validates them.
 */
import crypto from 'node:crypto';
import express from 'express';
import db from './db.js';
import { publicUser } from './base44Server.js';
import { sendEmail } from './integrations.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OTP_TTL_MS = 15 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const MIN_PASSWORD = 8;

/**
 * Sign the browser in as the admin automatically, with no login step.
 *
 * On by default: this install is one operator on one machine, Google sign-in
 * can't work self-hosted, and being asked for a password to reach your own
 * admin panel on localhost is friction with nothing behind it. It hands out a
 * real session token rather than faking authentication, so everything
 * downstream — entity writes, the admin-only edge functions — sees an ordinary
 * signed-in user.
 *
 * Set AUTO_LOGIN=false in .env to require a password again. Do that before
 * exposing this server beyond localhost: with it on, anyone who can reach the
 * port is an admin.
 */
const AUTO_LOGIN = process.env.AUTO_LOGIN !== 'false';

/* ── password hashing ───────────────────────────────────────────────────── */

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, user) {
  if (!user?.password_hash || !user?.password_salt) return false;
  const { hash } = hashPassword(password, user.password_salt);
  // Constant-time compare so a wrong guess can't be timed against a right one.
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.password_hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const sixDigits = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/* ── bootstrap ──────────────────────────────────────────────────────────── */

/**
 * Make sure there is always one admin account to sign in as. The password
 * comes from .env; when it is unset a random one is generated and printed
 * once, so the site is never left with a guessable default.
 */
export function ensureAdminAccount() {
  const email = (process.env.ADMIN_EMAIL || 'admin@localhost').toLowerCase();
  const existing = db.findUserByEmail(email);
  if (existing) return existing;

  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const { hash, salt } = hashPassword(password);
  const user = db.createUser({
    email,
    full_name: process.env.ADMIN_NAME || 'Site Admin',
    role: 'admin',
    verified: true,
    password_hash: hash,
    password_salt: salt,
  });

  console.log('\n  ┌─ Admin account created ────────────────────────────────');
  console.log(`  │  email:    ${email}`);
  if (process.env.ADMIN_PASSWORD) {
    console.log('  │  password: (from ADMIN_PASSWORD in .env)');
  } else {
    console.log(`  │  password: ${password}`);
    console.log('  │  Set ADMIN_PASSWORD in .env to choose your own.');
  }
  console.log('  └────────────────────────────────────────────────────────\n');

  return user;
}

/** Resolve the bearer token on a request to a user record, or null. */
export function userFromRequest(req) {
  const header = req.get?.('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? db.resolveSession(match[1]) : null;
}

export function tokenFromRequest(req) {
  const header = req.get?.('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** Express guard for routes only an admin may reach. */
export function requireAdmin(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  req.user = user;
  next();
}

/* ── delivery ───────────────────────────────────────────────────────────── */

/**
 * Try to email a code; always print it too. On a local box the console is the
 * reliable channel, and a verification code the operator can't reach would
 * lock them out of their own site.
 */
async function deliverCode(email, subject, line) {
  console.log(`\n  [auth] ${subject} for ${email}\n         ${line}\n`);
  try {
    await sendEmail({ to: email, subject, body: line });
  } catch (err) {
    console.warn(`  [auth] (email delivery failed: ${err.message})`);
  }
}

/* ── routes ─────────────────────────────────────────────────────────────── */

export function authRouter() {
  const router = express.Router();

  router.get('/me', (req, res) => {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    res.json(publicUser(user));
  });

  /**
   * Mint a session for the admin without credentials. The client calls this
   * only when it has no token of its own; see base44Client.js.
   */
  router.post('/auto-login', (req, res) => {
    if (!AUTO_LOGIN) {
      return res.status(403).json({ error: 'Automatic login is disabled' });
    }
    const email = (process.env.ADMIN_EMAIL || 'admin@localhost').toLowerCase();
    const user = db.findUserByEmail(email);
    if (!user) return res.status(404).json({ error: 'No admin account' });

    const token = db.createSession(user.id, SESSION_TTL_MS);
    res.json({ access_token: token, user: publicUser(user) });
  });

  router.post('/register', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const fullName = req.body?.full_name;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }
    if (password.length < MIN_PASSWORD) {
      return res
        .status(400)
        .json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    }

    const existing = db.findUserByEmail(email);
    if (existing?.verified) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const { hash, salt } = hashPassword(password);
    const otp = sixDigits();
    const fields = {
      email,
      full_name: fullName || email.split('@')[0],
      // First account on a fresh install owns the site.
      role: db.listUsers().length === 0 ? 'admin' : 'user',
      verified: false,
      password_hash: hash,
      password_salt: salt,
      otp_code: otp,
      otp_expires: Date.now() + OTP_TTL_MS,
    };

    // Re-registering an unverified address just refreshes its code.
    if (existing) db.updateUser(existing.id, fields);
    else db.createUser(fields);

    await deliverCode(email, 'Your MyWeatherUK verification code', `Code: ${otp}`);
    res.json({ ok: true, message: 'Verification code sent' });
  });

  router.post('/verify-otp', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const otpCode = String(req.body?.otpCode || '').trim();

    const user = db.findUserByEmail(email);
    if (!user || !user.otp_code) {
      return res.status(400).json({ error: 'No pending verification for that address' });
    }
    if (user.otp_expires && user.otp_expires < Date.now()) {
      return res.status(400).json({ error: 'That code has expired — request a new one' });
    }
    if (user.otp_code !== otpCode) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    db.updateUser(user.id, {
      verified: true,
      otp_code: null,
      otp_expires: null,
    });
    const token = db.createSession(user.id, SESSION_TTL_MS);
    res.json({ access_token: token, user: publicUser(db.findUserById(user.id)) });
  });

  router.post('/resend-otp', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const user = db.findUserByEmail(email);
    if (!user || user.verified) {
      // Don't reveal which addresses exist.
      return res.json({ ok: true });
    }
    const otp = sixDigits();
    db.updateUser(user.id, { otp_code: otp, otp_expires: Date.now() + OTP_TTL_MS });
    await deliverCode(email, 'Your MyWeatherUK verification code', `Code: ${otp}`);
    res.json({ ok: true });
  });

  router.post('/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    const user = db.findUserByEmail(email);
    if (!user || !verifyPassword(password, user)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.verified) {
      return res.status(403).json({ error: 'Verify your email address before signing in' });
    }

    const token = db.createSession(user.id, SESSION_TTL_MS);
    res.json({ access_token: token, user: publicUser(user) });
  });

  router.post('/logout', (req, res) => {
    const token = tokenFromRequest(req);
    if (token) db.destroySession(token);
    res.status(204).end();
  });

  router.post('/reset-request', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const user = db.findUserByEmail(email);
    // Always answer the same way, so this can't be used to enumerate accounts.
    if (user) {
      const token = crypto.randomBytes(24).toString('hex');
      db.updateUser(user.id, { reset_token: token, reset_expires: Date.now() + RESET_TTL_MS });
      const link = `${process.env.SITE_URL || 'http://localhost:8787'}/reset-password?token=${token}`;
      await deliverCode(email, 'Reset your MyWeatherUK password', link);
    }
    res.json({ ok: true, message: 'If that address has an account, a reset link has been sent' });
  });

  router.post('/reset', (req, res) => {
    const resetToken = String(req.body?.resetToken || '');
    const newPassword = String(req.body?.newPassword || '');

    if (newPassword.length < MIN_PASSWORD) {
      return res
        .status(400)
        .json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    }
    const user = db.findUser((u) => u.reset_token && u.reset_token === resetToken);
    if (!user || (user.reset_expires && user.reset_expires < Date.now())) {
      return res.status(400).json({ error: 'That reset link is invalid or has expired' });
    }

    const { hash, salt } = hashPassword(newPassword);
    db.updateUser(user.id, {
      password_hash: hash,
      password_salt: salt,
      reset_token: null,
      reset_expires: null,
      verified: true,
    });
    res.json({ ok: true });
  });

  return router;
}

export default authRouter;
