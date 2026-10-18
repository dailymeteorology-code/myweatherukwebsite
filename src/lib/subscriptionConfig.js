/* ════════════════════════════════════════════════════════════════════════════
   subscriptionConfig.js — single source of truth for the Subscription page.

   The whole page (pricing tiers, the API product matrix, prices and API-credit
   usage) is stored as ONE JSON blob in the `SubscriptionMatrix` entity and edited
   through Admin Settings → Subscriptions. Both the public page and the admin
   editor read/write through the helpers here so they never drift.

   Cell types in the product matrix:
     { type: 'yes'  }              → green check  (included)
     { type: 'no'   }              → red cross    (not included)
     { type: 'text', text: '…' }   → custom label (e.g. "Application Only")
   ════════════════════════════════════════════════════════════════════════════ */
import { base44 } from '@/api/base44Client';

const yes  = () => ({ type: 'yes' });
const no   = () => ({ type: 'no' });
const text = (t) => ({ type: 'text', text: t });

// Order of tier ids used across the matrix cells.
export const DEFAULT_SUB_CONFIG = {
  intro: {
    title: 'Subscriptions',
    subtitle: 'Choose the plan that fits how much weather intelligence you need. Every plan includes API access — bigger plans unlock more products and more credits.',
  },
  tiers: [
    { id: 'free',       name: 'Free',       price: '£0',       period: '/month', priceNote: '',             badge: '',           badgeColor: '#94a3b8', highlight: false,
      apiUsage: ['5,000 credits/day', '150,000 credits/month (if monthly refresh selected)'] },
    { id: 'starter',    name: 'Starter',    price: '£7.99',    period: '/month', priceNote: '',             badge: '',           badgeColor: '#38bdf8', highlight: false,
      apiUsage: ['50,000 credits/day', '1,800,000 credits/month'] },
    { id: 'plus',       name: 'Plus',       price: '£17.99',   period: '/month', priceNote: '',             badge: 'Best Value', badgeColor: '#a78bfa', highlight: true,
      apiUsage: ['250,000 credits/day', '9,000,000 credits/month'] },
    { id: 'pro',        name: 'Pro',        price: '£44.99',   period: '/month', priceNote: '',             badge: 'Best Seller',badgeColor: '#f59e0b', highlight: false,
      apiUsage: ['2,500,000 credits/day', '90,000,000 credits/month'] },
    { id: 'enterprise', name: 'Enterprise', price: 'From £299',period: '/month', priceNote: 'custom quote', badge: '',           badgeColor: '#ef4444', highlight: false,
      apiUsage: ['Custom', 'Typically 50 million–500 million+ credits/day, or a custom monthly allocation depending on the contract.'] },
  ],
  products: [
    { id: 'p_thunderstorm', name: 'Thunderstorm Forecast',        cells: { free: yes(), starter: yes(), plus: yes(),  pro: yes(), enterprise: yes() } },
    { id: 'p_lightning',    name: 'Lightning Forecast',           cells: { free: no(),  starter: yes(), plus: yes(),  pro: yes(), enterprise: yes() } },
    { id: 'p_hail',         name: 'Hail Forecast',                cells: { free: no(),  starter: no(),  plus: yes(),  pro: yes(), enterprise: yes() } },
    { id: 'p_tornado',      name: 'Tornado Forecast',             cells: { free: no(),  starter: no(),  plus: yes(),  pro: yes(), enterprise: yes() } },
    { id: 'p_dna',          name: 'Weather DNA™',                 cells: { free: no(),  starter: no(),  plus: no(),   pro: yes(), enterprise: yes() } },
    { id: 'p_asi',          name: 'Atmospheric Similarity Index', cells: { free: no(),  starter: no(),  plus: no(),   pro: yes(), enterprise: yes() } },
    { id: 'p_replay',       name: 'Historical Replay',            cells: { free: no(),  starter: no(),  plus: no(),   pro: yes(), enterprise: yes() } },
    { id: 'p_tci',          name: 'TCI Sentinel',                 cells: { free: no(),  starter: no(),  plus: no(),   pro: yes(), enterprise: yes() } },
    { id: 'p_tcm5',         name: 'TCM NOVA',                  cells: { free: no(),  starter: no(),  plus: yes(),  pro: yes(), enterprise: yes() } },
    { id: 'p_tcm6',         name: 'TCM V6 Genesis',               cells: { free: no(),  starter: no(),  plus: no(),   pro: no(),  enterprise: text('Application Only') } },
  ],
};

// Guarantee a well-formed config even if the stored blob is partial/old.
export function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  return {
    intro:    { ...DEFAULT_SUB_CONFIG.intro, ...(cfg.intro || {}) },
    tiers:    Array.isArray(cfg.tiers)    && cfg.tiers.length    ? cfg.tiers    : DEFAULT_SUB_CONFIG.tiers,
    products: Array.isArray(cfg.products) && cfg.products.length ? cfg.products : DEFAULT_SUB_CONFIG.products,
  };
}

// Read a single matrix cell, defaulting to "not included".
export function cellFor(product, tierId) {
  const c = product?.cells?.[tierId];
  if (!c) return { type: 'no' };
  if (typeof c === 'boolean') return { type: c ? 'yes' : 'no' };
  return c;
}

// Load the config (+ record id so the editor can update in place).
export async function loadSubConfig() {
  try {
    const list = await base44.entities.SubscriptionMatrix.list('-updated_date', 1);
    const rec = Array.isArray(list) ? list[0] : null;
    if (rec?.data) {
      let parsed = null;
      try { parsed = JSON.parse(rec.data); } catch { parsed = null; }
      return { id: rec.id, config: normalizeConfig(parsed) };
    }
    return { id: rec?.id || null, config: DEFAULT_SUB_CONFIG };
  } catch {
    return { id: null, config: DEFAULT_SUB_CONFIG };
  }
}

// Create or update the singleton record.
export async function saveSubConfig(id, config) {
  const payload = { data: JSON.stringify(config) };
  if (id) return base44.entities.SubscriptionMatrix.update(id, payload);
  return base44.entities.SubscriptionMatrix.create(payload);
}
