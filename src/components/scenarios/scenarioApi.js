/**
 * Weather Scenarios — data access. One catalogue fetch per session (the
 * server sends it gzipped with an ETag), full records fetched on demand and
 * memoised, admin calls authenticated with the site's existing token.
 */
import { useEffect, useState } from 'react';

const TOKEN_KEY = 'base44_access_token';
function authHeaders() {
  try { const t = localStorage.getItem(TOKEN_KEY); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

let catalogPromise = null;
export function loadCatalogue(force = false) {
  if (!catalogPromise || force) {
    catalogPromise = fetch('/api/scenarios/catalogue').then((r) => {
      if (!r.ok) throw new Error(`Catalogue unavailable (${r.status})`);
      return r.json();
    }).then((c) => {
      c.byId = new Map(c.scenarios.map((s) => [s.id, s]));
      c.eventById = new Map(c.events.map((e) => [e.id, e]));
      c.sourceById = new Map(c.sources.map((s) => [s.id, s]));
      c.catById = new Map(c.taxonomy.categories.map((x) => [x.id, x]));
      c.regionById = new Map(c.taxonomy.regions.map((x) => [x.id, x]));
      return c;
    }).catch((e) => { catalogPromise = null; throw e; });
  }
  return catalogPromise;
}

export function useCatalogue() {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    let live = true;
    loadCatalogue().then((data) => live && setState({ data, error: null })).catch((error) => live && setState({ data: null, error }));
    return () => { live = false; };
  }, []);
  return state;
}

const itemCache = new Map();
export function loadItem(id) {
  if (!itemCache.has(id)) {
    itemCache.set(id, fetch(`/api/scenarios/item/${encodeURIComponent(id)}`).then((r) => {
      if (!r.ok) throw new Error(r.status === 404 ? 'Scenario not found' : `Could not load scenario (${r.status})`);
      return r.json();
    }).catch((e) => { itemCache.delete(id); throw e; }));
  }
  return itemCache.get(id);
}
export function useItem(id) {
  const [state, setState] = useState({ data: null, error: null, loading: !!id });
  useEffect(() => {
    if (!id) { setState({ data: null, error: null, loading: false }); return undefined; }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loadItem(id).then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }));
    return () => { live = false; };
  }, [id]);
  return state;
}

let geoPromise = null;
export function loadRegionsGeo() {
  if (!geoPromise) geoPromise = fetch('/api/scenarios/regions.geo.json').then((r) => r.json()).catch((e) => { geoPromise = null; throw e; });
  return geoPromise;
}

export async function adminCall(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/scenarios/admin${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || `Request failed (${res.status})`); err.details = data.errors; throw err; }
  return data;
}
export function clearScenarioCaches() { catalogPromise = null; itemCache.clear(); }
