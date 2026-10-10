// ── AI authentication / sanity-check for TCM forecasts ──────────────────────
// Sends the forecast summary to an LLM acting as a meteorologist. The model
// flags physically implausible combinations (e.g. tornado risk with no CAPE,
// hail risk with high freezing level) and returns a verdict.
//
// Returns: {
//   verdict: 'APPROVED' | 'ADJUSTED' | 'FLAGGED',
//   confidence: 0-100,
//   notes: string,
//   issues: [{ day, risk, reason }],
//   adjustedAt: timestamp
// }

import { base44 } from '@/api/base44Client';

function compactSummary(payload, regionLabel, runISO) {
  const days = (payload?.summary || []).map((d, i) => ({
    day: i,
    label: ['Today', 'Tomorrow', 'D3', 'D4'][i],
    thunderstorm: d.thunderstorm,
    hail: d.hail,
    tornado: d.tornado,
    lightning: d.lightning,
    coverage_pct: d.totalCells ? Math.round((d.stormyCells / d.totalCells) * 100) : 0,
    peak_cape_jkg: d.ranges?.cape?.max ?? 0,
    peak_shear_ms: d.ranges?.shear?.max ?? 0,
    peak_gust_mph: d.ranges?.gust?.max ?? 0,
    peak_precip_mmhr: d.ranges?.precip?.max ?? 0,
    sub_tornado: d.sub?.tornado ?? 0,
    sub_hail: d.sub?.hail ?? 0,
    sub_supercell: d.sub?.supercell ?? 0,
  }));
  return {
    region: regionLabel,
    run_init: runISO,
    cell_count: payload?.cellCount ?? payload?.grid?.length ?? 0,
    days,
  };
}

// Cache verdicts in localStorage per (region, run) for 24 h so we don't
// re-spend integration credits every time the page reloads or the user
// switches tabs. Keyed by region+run init time.
const VERDICT_CACHE_PREFIX = 'tcm_ai_verdict_v1_';
const VERDICT_TTL_MS = 24 * 60 * 60 * 1000;

function loadCachedVerdict(regionLabel, runISO) {
  try {
    const key = VERDICT_CACHE_PREFIX + regionLabel + '_' + runISO;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - (parsed.adjustedAt || 0) > VERDICT_TTL_MS) return null;
    return parsed;
  } catch { return null; }
}

function saveCachedVerdict(regionLabel, runISO, verdict) {
  try {
    const key = VERDICT_CACHE_PREFIX + regionLabel + '_' + runISO;
    localStorage.setItem(key, JSON.stringify(verdict));
  } catch {}
}

export async function verifyForecastWithAI({ payload, regionLabel, runISO }) {
  // Skip the LLM call entirely if we have a cached verdict for this run.
  const cached = loadCachedVerdict(regionLabel, runISO);
  if (cached) return cached;

  const compact = compactSummary(payload, regionLabel, runISO);

  const prompt = `You are an experienced operational meteorologist reviewing a 4-day convective outlook for ${regionLabel}. The forecast was built from Open-Meteo model data using a CAPE/shear/inhibition risk engine.

Forecast summary (per day):
${JSON.stringify(compact, null, 2)}

Risk score scale: 0–100. Levels: 0–4 No Risk, 5–11 Very Low, 12–21 Low, 22–34 Marginal, 35–49 Slight, 50–64 Moderate, 65–79 High, 80+ Severe.

Your job:
1. Check that risk scores are physically consistent with the atmospheric metrics (CAPE, shear, gust, precipitation).
2. Flag any obvious problems — e.g. tornado risk above 20 with CAPE < 200 J/kg, hail above 30 with freezing level implied too high (low CAPE), or coverage % drastically inconsistent with peak CAPE.
3. Decide a verdict:
   • APPROVED — forecast looks physically reasonable.
   • ADJUSTED — minor inconsistencies; would soften specific risks but the broad picture is correct.
   • FLAGGED — major problems; risk levels appear unrealistic.
4. Provide a short plain-English note (max 2 sentences) summarising the day-1 outlook in meteorological terms.
5. List any specific issues (max 3).`;

  const schema = {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['APPROVED', 'ADJUSTED', 'FLAGGED'] },
      confidence: { type: 'number', minimum: 0, maximum: 100 },
      notes: { type: 'string' },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            day: { type: 'number' },
            risk: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['risk', 'reason'],
        }
      },
    },
    required: ['verdict', 'confidence', 'notes'],
  };

  const result = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: schema,
  });

  const verdict = { ...result, adjustedAt: Date.now() };
  saveCachedVerdict(regionLabel, runISO, verdict);
  return verdict;
}