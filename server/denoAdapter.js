/**
 * Runs the Base44 edge functions under Node, unmodified.
 *
 * The sources in ./base44-functions are byte-identical copies of
 * `base44/functions/<name>/entry.ts` from the export. They are plain ES
 * modules despite the .ts extension — no TypeScript syntax anywhere — and they
 * touch exactly two things Node doesn't provide:
 *
 *   1. `import { createClientFromRequest } from 'npm:@base44/sdk@x.y.z'`
 *   2. the `Deno` global — only `Deno.serve(handler)` and `Deno.env.get(key)`
 *
 * So the port is mechanical: rewrite that one import specifier to point at
 * ./base44Server.js, install a `Deno` shim whose `serve()` captures the handler
 * instead of binding a port, and call the captured handler with a normal
 * Request. Node 18+ supplies fetch/Request/Response/AbortSignal.timeout
 * natively, which is everything else these functions use.
 *
 * The rewritten copies land in ./.functions-build (regenerated on every boot,
 * safe to delete). Keeping the originals untouched means a fresh export drops
 * straight in — the same rule the frontend files follow.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(here, 'base44-functions');
const BUILD_DIR = path.join(here, '.functions-build');

/** Matches the SDK import in every function, at any pinned version. */
const SDK_IMPORT = /(['"])npm:@base44\/sdk@[^'"]*\1/g;

/**
 * `Deno.serve(handler)` runs at module top level, so the handler has to be
 * caught as a side effect of importing. One import at a time, into this slot.
 */
let captured = null;

function installDenoGlobal() {
  if (globalThis.Deno) return;
  globalThis.Deno = {
    env: {
      get: (key) => process.env[key],
      has: (key) => process.env[key] !== undefined,
      toObject: () => ({ ...process.env }),
    },
    serve: (handlerOrOptions, maybeHandler) => {
      // Deno.serve accepts (handler) or (options, handler); the functions all
      // use the first form, but honour both rather than silently capturing an
      // options object.
      captured =
        typeof handlerOrOptions === 'function' ? handlerOrOptions : maybeHandler;
      return { finished: Promise.resolve(), shutdown: () => {}, ref: () => {}, unref: () => {} };
    },
  };
}

/** Copy each function source into the build dir with the specifier rewritten. */
function prepare() {
  if (!fs.existsSync(SRC_DIR)) return [];
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  const names = fs
    .readdirSync(SRC_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(SRC_DIR, e.name, 'entry.ts')))
    .map((e) => e.name);

  for (const name of names) {
    const source = fs.readFileSync(path.join(SRC_DIR, name, 'entry.ts'), 'utf8');
    const rewritten = source.replace(SDK_IMPORT, "'../base44Server.js'");
    fs.writeFileSync(path.join(BUILD_DIR, `${name}.mjs`), rewritten);
  }
  return names;
}

/**
 * Load every function and return { name -> handler }. A function that fails to
 * load is reported and skipped rather than taking the server down with it.
 */
export async function loadEdgeFunctions() {
  installDenoGlobal();
  const handlers = {};
  const failures = [];

  for (const name of prepare()) {
    captured = null;
    try {
      // Cache-bust so a restart in watch mode picks up an edited source.
      const url = `${pathToFileURL(path.join(BUILD_DIR, `${name}.mjs`)).href}?t=${Date.now()}`;
      await import(url);
      if (typeof captured !== 'function') {
        failures.push(`${name}: never called Deno.serve()`);
        continue;
      }
      handlers[name] = captured;
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
    }
  }

  captured = null;
  return { handlers, failures };
}

/**
 * Bridge an Express request to a captured handler and write its Response back.
 * The handler sees a normal Request — same URL, method, headers and JSON body
 * it saw on Base44.
 */
export async function runEdgeFunction(handler, req, res) {
  const url = `${req.protocol}://${req.get('host') || 'localhost'}${req.originalUrl}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value != null) headers.set(key, String(value));
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
  });

  const response = await handler(request);
  if (!(response instanceof Response)) {
    res.status(500).json({ error: 'Function did not return a Response' });
    return;
  }

  res.status(response.status);
  response.headers.forEach((value, key) => {
    // Express sets its own framing headers; copying these corrupts the reply.
    if (!/^(content-length|transfer-encoding|connection)$/i.test(key)) {
      res.setHeader(key, value);
    }
  });
  const text = await response.text();
  res.send(text);
}
