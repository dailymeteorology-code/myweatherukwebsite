/**
 * Server-side stand-in for `npm:@base44/sdk`, as used inside the Base44 edge
 * functions.
 *
 * The function sources under ../base44-functions are the Base44 originals with
 * exactly one change: their `npm:@base44/sdk@x.y.z` import specifier is
 * rewritten to point here (see denoAdapter.js). Everything they then call —
 * `base44.asServiceRole.entities.X.filter(...)`, `base44.auth.me()` — resolves
 * against the local JSON store instead of Base44's cloud.
 *
 * Two privilege levels, mirroring the real SDK:
 *   base44.entities / auth / integrations   act as the calling user
 *   base44.asServiceRole.*                  act as the backend itself
 * Locally the data store is the same either way; the distinction still matters
 * because `auth.me()` must reflect the actual caller for the admin checks the
 * functions perform.
 */
import db, { isValidEntityName } from './db.js';
import { invokeLLM, sendEmail } from './integrations.js';

function entityApi(name) {
  if (!isValidEntityName(name)) {
    throw new Error(`Invalid entity name: ${name}`);
  }
  return {
    async list(sort, limit) {
      return db.list(name, { sort, limit });
    },
    async filter(query, sort, limit) {
      return db.list(name, { query, sort, limit });
    },
    async get(id) {
      return db.get(name, id);
    },
    async create(data) {
      return db.create(name, data || {});
    },
    async bulkCreate(rows) {
      return db.bulkCreate(name, Array.isArray(rows) ? rows : [rows]);
    },
    async update(id, data) {
      return db.update(name, id, data || {});
    },
    async delete(id) {
      return db.remove(name, id);
    },
  };
}

/** Entities resolve on first access, so a new one needs no change here. */
const entities = new Proxy(
  {},
  {
    get(_t, prop) {
      return typeof prop === 'string' ? entityApi(prop) : undefined;
    },
    has: () => true,
  }
);

const integrations = {
  Core: {
    InvokeLLM: (params) => invokeLLM(params),
    SendEmail: (params) => sendEmail(params),
  },
};

/**
 * Base44 brokered OAuth connections (Gmail, etc.) on the builder's behalf.
 * Self-hosted there is no broker, so this reports "not connected" and callers
 * take their existing failure path — sendOutlookEmailAlert, the only user,
 * already returns a clean 503 for it.
 */
const connectors = {
  async getConnection(name) {
    if (name === 'gmail' && process.env.GMAIL_ACCESS_TOKEN) {
      return { accessToken: process.env.GMAIL_ACCESS_TOKEN };
    }
    return { accessToken: null, connected: false };
  },
};

/**
 * Function-to-function calls. The registry is injected by index.js once every
 * handler is loaded, which avoids a require cycle between the two modules.
 */
let invokeFunction = async (name) => {
  throw new Error(`Function "${name}" cannot be invoked before the registry is ready`);
};

export function setFunctionInvoker(fn) {
  invokeFunction = fn;
}

const functions = {
  invoke: (name, payload) => invokeFunction(name, payload),
};

/** Pull the bearer token off an incoming Request (the edge-function shape). */
function tokenFromRequest(req) {
  const header = req?.headers?.get?.('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function buildClient(req) {
  const auth = {
    /** Resolves to the signed-in user, or null when the caller is anonymous. */
    async me() {
      const user = db.resolveSession(tokenFromRequest(req));
      if (!user) {
        const err = new Error('Not authenticated');
        err.status = 401;
        throw err;
      }
      return publicUser(user);
    },
  };

  const asServiceRole = { entities, integrations, connectors, functions };

  return { entities, auth, integrations, connectors, functions, asServiceRole };
}

/** Strip the password hash before a user record leaves the server. */
export function publicUser(user) {
  if (!user) return null;
  const { password_hash, password_salt, otp_code, otp_expires, reset_token, reset_expires, ...safe } =
    user;
  return safe;
}

export function createClientFromRequest(req) {
  return buildClient(req);
}

/** Used by scheduled jobs, which have no incoming request to authenticate. */
export function createServiceClient() {
  return buildClient(null);
}

export const base44 = createServiceClient();
export default { createClientFromRequest, createServiceClient, base44 };
