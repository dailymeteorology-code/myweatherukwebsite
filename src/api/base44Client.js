/**
 * Self-hosted replacement for the Base44 SDK client.
 *
 * Every page and component in this project is a byte-identical copy of the
 * Base44 export, so they all still call `base44.entities.X.list()`,
 * `base44.auth.me()`, `base44.functions.invoke()` and so on. This module keeps
 * that exact call surface but points it at the local Express server in
 * ../../server instead of Base44's cloud backend. Nothing else in the app had
 * to change, which means a fresh export of any component drops straight in.
 *
 * Surface implemented (everything the app actually uses):
 *   entities.<Name>.list(sort?, limit?) / .filter(query, sort?, limit?)
 *   entities.<Name>.get(id) / .create(data) / .update(id, data) / .delete(id)
 *   entities.<Name>.subscribe(cb) -> unsubscribe()
 *   auth.me / login / logout / redirectToLogin / setToken / getToken
 *   auth.loginViaEmailPassword / loginWithProvider / register
 *   auth.verifyOtp / resendOtp / resetPasswordRequest / resetPassword
 *   functions.invoke(name, payload)
 *   integrations.Core.InvokeLLM / SendEmail / UploadFile
 *   appLogs.logUserInApp(pageName)
 *   getConfig()
 */

const API = import.meta.env.VITE_API_BASE_URL || '/api';

/* ── session token ─────────────────────────────────────────────────────────
 * Base44 kept its access token in localStorage under `base44_access_token`
 * and app-params.js still reads that key, so we use the same one. The local
 * server issues opaque session tokens; nothing parses them client-side.
 */
const TOKEN_KEY = 'base44_access_token';

/**
 * Set when you press Log out, so an explicit sign-out isn't undone by the
 * automatic admin login below. Cleared when you sign in again.
 */
const AUTO_LOGIN_OFF_KEY = 'mwuk_auto_login_off';

function autoLoginDisabled() {
  try {
    return localStorage.getItem(AUTO_LOGIN_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

function setAutoLoginDisabled(off) {
  try {
    if (off) localStorage.setItem(AUTO_LOGIN_OFF_KEY, '1');
    else localStorage.removeItem(AUTO_LOGIN_OFF_KEY);
  } catch {
    /* storage disabled — auto-login simply stays on */
  }
}

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null; // private mode / storage disabled
  }
}

function writeToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* not fatal — the session just won't survive a reload */
  }
}

async function request(path, options = {}) {
  const token = readToken();
  const res = await fetch(`${API}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error || '';
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(detail || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Base44's list/filter take a sort string like '-created_date' and an optional
 * limit; filter also takes an equality query object. Encode all three as query
 * params so the server can apply them.
 */
function buildQuery({ query, sort, limit }) {
  const params = new URLSearchParams();
  if (query && Object.keys(query).length) params.set('q', JSON.stringify(query));
  if (sort) params.set('sort', sort);
  if (limit != null) params.set('limit', String(limit));
  const s = params.toString();
  return s ? `?${s}` : '';
}

/* ── live updates ──────────────────────────────────────────────────────────
 * Base44 pushed entity changes to subscribers. The local server exposes the
 * same thing over Server-Sent Events; one shared connection fans out to every
 * subscriber so multiple components don't each open a stream.
 */
const listeners = new Map(); // entityName -> Set<callback>
let eventSource = null;

function ensureEventStream() {
  if (eventSource || typeof window === 'undefined') return;
  try {
    eventSource = new EventSource(`${API}/events`);
    eventSource.onmessage = (msg) => {
      let event;
      try {
        event = JSON.parse(msg.data);
      } catch {
        return;
      }
      const subs = listeners.get(event.entity);
      if (!subs) return;
      // Shape matches the SDK's callback payload: { type, data }.
      for (const cb of subs) {
        try {
          cb({ type: event.type, data: event.data });
        } catch (err) {
          console.error('[base44Client] subscriber threw:', err);
        }
      }
    };
    eventSource.onerror = () => {
      // EventSource reconnects on its own; nothing to do but avoid noisy logs.
    };
  } catch (err) {
    console.warn('[base44Client] live updates unavailable:', err?.message);
  }
}

/* ── static fallback (Netlify) ────────────────────────────────────────────
 * The GitHub → Netlify build has no server. When the API is unreachable (or
 * answers with the SPA's HTML instead of JSON), read the public snapshot that
 * `npm run export:public` writes to /static-data/<Entity>.json, and apply the
 * same filter / sort / limit here. Entities without a snapshot return [].
 */
const staticCache = new Map();
async function staticRows(name) {
  if (!staticCache.has(name)) {
    staticCache.set(name, fetch(`/static-data/${name}.json`)
      .then((r) => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : []))
      .catch(() => []));
  }
  return staticCache.get(name);
}
function applyQuery(rows, { query, sort, limit }) {
  let out = Array.isArray(rows) ? rows.slice() : [];
  if (query) out = out.filter((r) => Object.entries(query).every(([k, v]) => r[k] === v));
  if (sort) {
    const desc = sort.startsWith('-'); const key = desc ? sort.slice(1) : sort;
    out.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (desc ? -1 : 1));
  }
  return limit != null ? out.slice(0, limit) : out;
}
async function readWithFallback(name, opts) {
  try {
    return await request(`/entities/${name}${buildQuery(opts)}`);
  } catch (err) {
    if (err?.status && err.status !== 404 && err.status < 500) throw err; // real auth/validation errors
    return applyQuery(await staticRows(name), opts);
  }
}

function makeEntity(name) {
  return {
    async list(sort, limit) {
      return readWithFallback(name, { sort, limit });
    },
    async filter(query, sort, limit) {
      return readWithFallback(name, { query, sort, limit });
    },
    async get(id) {
      return request(`/entities/${name}/${encodeURIComponent(id)}`);
    },
    async create(data) {
      return request(`/entities/${name}`, { method: 'POST', body: JSON.stringify(data) });
    },
    async bulkCreate(rows) {
      return request(`/entities/${name}/bulk`, {
        method: 'POST',
        body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
      });
    },
    async update(id, data) {
      return request(`/entities/${name}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },
    async delete(id) {
      return request(`/entities/${name}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    subscribe(callback) {
      if (typeof callback !== 'function') return () => {};
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
      ensureEventStream();
      return () => {
        listeners.get(name)?.delete(callback);
      };
    },
  };
}

/**
 * Entities are created on first access rather than from a fixed list, so an
 * export that adds a new entity needs no change here — the server creates the
 * collection the first time it is written to.
 */
const entityCache = new Map();
const entities = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (!entityCache.has(prop)) entityCache.set(prop, makeEntity(prop));
      return entityCache.get(prop);
    },
    has: () => true,
  }
);

/* ── auth ──────────────────────────────────────────────────────────────────
 * The local server keeps accounts in its JSON store and issues opaque session
 * tokens. Sign-up still runs the email-verification step the Register page
 * expects; with no mail service configured the code is printed to the server
 * console instead of being emailed (see server/auth.js).
 */
/**
 * Ask the server for an admin session when the browser has none.
 *
 * The server decides whether to allow it (AUTO_LOGIN in .env); a refusal is
 * the normal "you need to log in" path, not an error worth surfacing. The
 * in-flight promise is shared so several components calling me() at once don't
 * each mint a session.
 */
let autoLoginInFlight = null;

function tryAutoLogin() {
  if (autoLoginDisabled()) return Promise.resolve(null);
  if (autoLoginInFlight) return autoLoginInFlight;

  autoLoginInFlight = request('/auth/auto-login', { method: 'POST' })
    .then((result) => {
      if (!result?.access_token) return null;
      writeToken(result.access_token);
      return result.access_token;
    })
    .catch(() => null) // auto-login off, or no admin account yet
    .finally(() => {
      autoLoginInFlight = null;
    });

  return autoLoginInFlight;
}

const auth = {
  getToken: readToken,

  setToken(token) {
    writeToken(token);
    return token;
  },

  /** Cheap signed-in check that never throws. */
  async isAuthenticated() {
    try {
      await auth.me();
      return true;
    } catch {
      return false;
    }
  },

  async me() {
    // With no token of our own, see if the server will just sign us in as the
    // admin. The app treats a rejected me() as "signed out", so keep that
    // contract when it won't.
    if (!readToken() && !(await tryAutoLogin())) {
      const err = new Error('Not authenticated');
      err.status = 401;
      throw err;
    }
    const user = await request('/auth/me');
    if (!user) {
      const err = new Error('Not authenticated');
      err.status = 401;
      throw err;
    }
    return user;
  },

  async loginViaEmailPassword(email, password) {
    const result = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (result?.access_token) {
      writeToken(result.access_token);
      setAutoLoginDisabled(false); // signing in ends an earlier opt-out
    }
    return result;
  },

  /** Alias kept for callers that use the SDK's generic login(). */
  async login(email, password) {
    return auth.loginViaEmailPassword(email, password);
  },

  loginWithProvider(provider) {
    // Social sign-in needs an OAuth client registered with the provider and a
    // public callback URL, neither of which exists on a local box. Fail loudly
    // rather than silently doing nothing when the button is pressed.
    const err = new Error(
      `${provider === 'google' ? 'Google' : provider} sign-in is not available in the ` +
        'self-hosted build — sign in with your email and password instead.'
    );
    if (typeof window !== 'undefined') window.alert(err.message);
    return Promise.reject(err);
  },

  async register({ email, password, full_name } = {}) {
    return request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, full_name }),
    });
  },

  async verifyOtp({ email, otpCode } = {}) {
    const result = await request('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otpCode }),
    });
    if (result?.access_token) {
      writeToken(result.access_token);
      setAutoLoginDisabled(false);
    }
    return result;
  },

  async resendOtp(email) {
    return request('/auth/resend-otp', { method: 'POST', body: JSON.stringify({ email }) });
  },

  async resetPasswordRequest(email) {
    return request('/auth/reset-request', { method: 'POST', body: JSON.stringify({ email }) });
  },

  async resetPassword({ resetToken, newPassword } = {}) {
    return request('/auth/reset', {
      method: 'POST',
      body: JSON.stringify({ resetToken, newPassword }),
    });
  },

  logout(redirectUrl) {
    // Remember the choice, or the automatic admin login would sign you
    // straight back in on the reload below.
    setAutoLoginDisabled(true);
    request('/auth/logout', { method: 'POST' })
      .catch(() => {})
      .finally(() => {
        writeToken(null);
        if (typeof window === 'undefined') return;
        if (redirectUrl) window.location.href = redirectUrl;
        else window.location.reload();
      });
  },

  redirectToLogin(fromUrl) {
    // No hosted login page when self-hosting — the app serves its own /login.
    if (typeof window === 'undefined') return;
    const next = fromUrl || window.location.href;
    window.location.href = `/login?from_url=${encodeURIComponent(next)}`;
  },
};

const functions = {
  async invoke(name, payload = {}) {
    return request(`/functions/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

const integrations = {
  Core: {
    /**
     * Base44 ran these server-side with its own provider keys. The local server
     * does the same with whatever is configured in .env, and returns a clear
     * error when nothing is — see server/integrations.js.
     */
    async InvokeLLM(params) {
      return request('/integrations/invoke-llm', {
        method: 'POST',
        body: JSON.stringify(params || {}),
      });
    },

    async SendEmail(params) {
      return request('/integrations/send-email', {
        method: 'POST',
        body: JSON.stringify(params || {}),
      });
    },

    /** Stores the file under server/uploads and returns its served URL. */
    async UploadFile({ file }) {
      const token = readToken();
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`${API}/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      return res.json(); // { file_url }
    },
  },
};

/** Page-view logging. Base44 collected these centrally; we keep them local. */
const appLogs = {
  async logUserInApp(pageName) {
    return request('/logs/page-view', {
      method: 'POST',
      body: JSON.stringify({ page: pageName, at: new Date().toISOString() }),
    });
  },
};

/** Some components read the app id off the client to build API URLs. */
function getConfig() {
  return {
    appId: import.meta.env.VITE_BASE44_APP_ID || 'self-hosted',
    serverUrl: API,
  };
}

export const base44 = { entities, auth, functions, integrations, appLogs, getConfig };
export default base44;
