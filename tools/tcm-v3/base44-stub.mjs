// In-memory stand-in for the site database, used only by tools/tcm-v3/build.mjs so V3's
// own saveTCMRunToDB can run on GitHub; the rows it writes are published for the site.
const store = [];
let nextId = 1;
const match = (row, q) => Object.entries(q || {}).every(([k, v]) => row[k] === v);

export const rows = () => store.map((r) => ({ ...r }));

export const base44 = {
  auth: { me: async () => null },
  entities: new Proxy({}, {
    get: () => ({
      filter: async (q, sort, limit) => store.filter((r) => match(r, q)).slice(0, limit || 100),
      list: async () => store.slice(),
      create: async (row) => { const r = { ...row, id: String(nextId++) }; store.push(r); return r; },
      update: async (id, patch) => { const r = store.find((x) => x.id === id); Object.assign(r, patch); return r; },
      delete: async (id) => { const i = store.findIndex((x) => x.id === id); if (i >= 0) store.splice(i, 1); },
    }),
  }),
};
export default base44;
