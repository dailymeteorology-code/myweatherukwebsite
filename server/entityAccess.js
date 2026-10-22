/**
 * Who may read and write each entity through /api/entities.
 *
 * The entity API used to answer anyone: every record could be read, changed or deleted by
 * whoever reached the server (the newsletter's subscribers, access requests and codes, every
 * user's saved studio graphics with their emails, the site settings with the universal access
 * key). Base44 enforced row-level security on its side; the self-hosted server now does.
 *
 * Levels, for reading and for each kind of write:
 *   public  anyone
 *   auth    anyone signed in
 *   owner   the signed-in user who made the record (created_by_id / created_by / user_email)
 *   admin   admins only
 * Admins may do anything. Unless an entity says otherwise, reading is public and writing is
 * admin-only. A read a visitor may not make returns nothing (an empty list, or 404 for one
 * record) rather than an error, so the pages that look for, say, their own saves stay quiet.
 *
 * Public writes are cleaned (`clean`): a visitor's access request is always pending and their
 * access code always inactive, whatever the request says. Who made a record is set by the
 * server and cannot be supplied or changed by the client.
 */
import crypto from 'node:crypto';

const PUBLIC = 'public', AUTH = 'auth', OWNER = 'owner', ADMIN = 'admin';
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] !== undefined).map((k) => [k, obj[k]]));
const str = (v, n) => (v == null ? v : String(v).slice(0, n));

export const RULES = {
  /* the site-closed gate: anyone may ask for access; what they ask is the admin's to read */
  AccessRequest: {
    read: ADMIN, create: PUBLIC,
    clean: (b) => ({ ...pick(b, ['full_name', 'email', 'social_media_handle', 'invitation_token', 'reason', 'message']), status: 'pending' }),
  },
  SiteAccessCode: {
    read: ADMIN, create: PUBLIC,
    /* a requested code: inactive until an admin approves it, its value made here */
    clean: (b) => ({ email: str(b.email, 200), code: crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8), is_active: false }),
  },
  /* sign-up and verification go through /api/newsletter (publicFlows.js) */
  NewsletterSubscriber: { read: ADMIN },
  /* readable by everyone (the pages are built from them) bar the gate's key */
  SiteSettings: { redact: ['universal_access_key'] },
  /* each person's own */
  StudioGraphic: { read: OWNER, create: AUTH, update: OWNER, delete: OWNER },
  EmailNotificationPref: { read: OWNER, create: AUTH, update: OWNER, delete: OWNER },
  LocationSearchHistory: { read: OWNER, create: AUTH, update: OWNER, delete: OWNER },
  /* the admin's business only */
  UserSubscription: { read: ADMIN },
  SubscriptionCoupon: { read: ADMIN },
  SubscriptionSale: { read: ADMIN },
  User: { read: ADMIN },
};

const OWNER_FIELDS = ['created_by', 'created_by_id'];
const ruleOf = (entity) => RULES[entity] || {};
export const readLevel = (entity) => ruleOf(entity).read || PUBLIC;
const writeLevel = (entity, op) => ruleOf(entity)[op] || ADMIN;

export function isOwner(row, user) {
  if (!row || !user) return false;
  const email = String(user.email || '').toLowerCase();
  return row.created_by_id === user.id
    || (email && String(row.created_by || '').toLowerCase() === email)
    || (email && String(row.user_email || '').toLowerCase() === email);
}

/** May `user` read this entity at all (true, false, or 'own' for their own rows only)? */
export function canRead(entity, user) {
  if (user?.role === 'admin') return true;
  const lv = readLevel(entity);
  if (lv === PUBLIC) return true;
  if (lv === AUTH) return !!user;
  if (lv === OWNER) return user ? 'own' : false;
  return false;
}

/** The rows `user` may see, with fields only admins may see taken out. */
export function visibleRows(entity, rows, user) {
  const can = canRead(entity, user);
  if (!can) return [];
  const own = can === 'own' ? rows.filter((r) => isOwner(r, user)) : rows;
  return redactRows(entity, own, user);
}
export function redactRows(entity, rows, user) {
  const hide = ruleOf(entity).redact;
  if (!hide?.length || user?.role === 'admin') return rows;
  return rows.map((r) => { const c = { ...r }; for (const k of hide) delete c[k]; return c; });
}

/** May `user` make this write ('create' | 'update' | 'delete'), given the row it touches? */
export function canWrite(entity, op, user, row = null) {
  if (user?.role === 'admin') return true;
  const lv = writeLevel(entity, op);
  if (lv === PUBLIC) return true;
  if (lv === AUTH) return !!user;
  if (lv === OWNER) return !!user && isOwner(row, user);
  return false;
}

/** A create's payload as it is stored: cleaned for visitors, with who made it set here. */
export function prepareCreate(entity, body, user) {
  const clean = ruleOf(entity).clean;
  const base = user?.role === 'admin' || !clean ? { ...body } : clean(body || {});
  for (const k of OWNER_FIELDS) delete base[k];
  if (user) { base.created_by = user.email || null; base.created_by_id = user.id; }
  /* a signed-in user's own records carry their own email, never someone else's */
  if (user && user.role !== 'admin' && 'user_email' in base) base.user_email = user.email || '';
  return base;
}
/** An update's patch, never changing who made the record (or, for a non-admin, whose it is). */
export function prepareUpdate(body, user) {
  const patch = { ...(body || {}) };
  for (const k of OWNER_FIELDS) delete patch[k];
  if (user?.role !== 'admin') delete patch.user_email;
  return patch;
}

/** The live-update stream sends a change only where everyone may read it, redacted. */
export function broadcastable(entity, data) {
  if (readLevel(entity) !== PUBLIC) return null;
  const hide = ruleOf(entity).redact;
  if (!hide?.length || !data || typeof data !== 'object') return data;
  const c = { ...data };
  for (const k of hide) delete c[k];
  return c;
}

/* ── a small in-memory rate limit, for the public routes ── */
const hits = new Map();
/** True when `key` has used up `max` calls in `windowMs` (and counts this call otherwise). */
export function limited(bucket, key, max, windowMs) {
  const k = `${bucket}|${key}`, now = Date.now();
  const list = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) { hits.set(k, list); return true; }
  list.push(now);
  hits.set(k, list);
  if (hits.size > 5000) for (const [kk, v] of hits) if (!v.some((t) => now - t < 864e5)) hits.delete(kk);
  return false;
}
/** The client's address, through a tunnel's forwarding header where there is one. */
export function clientIp(req) {
  const fwd = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || 'unknown';
}
