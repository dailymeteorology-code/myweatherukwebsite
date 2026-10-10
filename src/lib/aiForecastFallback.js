// ── AI Forecast Fallback (FAST) ──────────────────────────────────────────────
// Last-resort fallback when both the Deno API and Open-Meteo are unreachable.
// Optimised for SPEED, not exhaustive accuracy — the real engines are the
// source of truth, this just keeps the map populated.
//
// Speed strategy (vs the old 2-stage 30-45s version):
//   1. NO web-search stage (was 15-25s on its own)
//   2. Single LLM call with cheap default model + tight prompt
//   3. Coarser 3×3 anchor grid (9 anchors) — model returns faster
//   4. SHARED server cache via `aiForecastCache` backend function so the
//      first user pays the LLM cost, every subsequent user gets it instantly
//
// Typical end-to-end: ~3-6s cold, <500ms warm (cache hit).

import { base44 } from '@/api/base44Client';

const STEPS_PER_DAY  = 8;
const HOURS_PER_STEP = 3;
const TOTAL_STEPS    = 32;

// 6×6 = 36 anchors — matches the denser 1.0°/0.35° output grid much better
const ANCHOR_COUNT = 6;

// ── Named-region labels ──────────────────────────────────────────────────────
function labelForUK(lat, lon) {
  if (lat >= 56) return lon < -4 ? 'Western Scotland' : 'Eastern Scotland';
  if (lat >= 53) return lon < -4 ? 'Northern Ireland / Irish Sea' : 'Northern England';
  if (lat >= 51) return lon < -3 ? 'Wales / Southwest England' : 'Midlands / Southeast England';
  return 'English Channel approaches';
}

function labelForEU(lat, lon) {
  if (lat >= 54) {
    if (lon < 0) return 'British Isles';
    if (lon < 15) return 'Northern Europe (DE/PL/DK)';
    return 'Baltic States';
  }
  if (lat >= 45) {
    if (lon < 5) return 'France / Benelux';
    if (lon < 20) return 'Central Europe (Alps/Czechia)';
    return 'SE Europe (Romania/Ukraine)';
  }
  if (lon < 5) return 'Iberia';
  if (lon < 18) return 'Italy / Adriatic';
  return 'Greece / E. Mediterranean';
}

function buildAnchors(bbox, isEurope) {
  const anchors = [];
  const dLat = (bbox.latMax - bbox.latMin) / (ANCHOR_COUNT - 1);
  const dLon = (bbox.lonMax - bbox.lonMin) / (ANCHOR_COUNT - 1);
  for (let j = 0; j < ANCHOR_COUNT; j++) {
    for (let i = 0; i < ANCHOR_COUNT; i++) {
      const lat = +(bbox.latMin + j * dLat).toFixed(2);
      const lon = +(bbox.lonMin + i * dLon).toFixed(2);
      anchors.push({
        lat, lon,
        label: isEurope ? labelForEU(lat, lon) : labelForUK(lat, lon),
      });
    }
  }
  return anchors;
}

function buildFullCoords(bbox, step) {
  const out = [];
  for (let lat = bbox.latMin; lat <= bbox.latMax + 1e-9; lat += step) {
    for (let lon = bbox.lonMin; lon <= bbox.lonMax + 1e-9; lon += step) {
      out.push({ lat: +lat.toFixed(3), lon: +lon.toFixed(3) });
    }
  }
  return out;
}

function expandScores(ts, cape, shear, gust) {
  ts = Math.max(0, Math.min(100, Math.round(ts)));
  cape = Math.max(0, Math.min(5000, Math.round(cape || 0)));
  shear = Math.max(0, Math.min(40, Number(shear) || 0));
  gust = Math.max(0, Math.min(120, Number(gust) || 0));

  const capeTerm = Math.min(1, cape / 2000);
  const shearTerm = Math.min(1, shear / 25);
  const hail = ts < 15 ? 0 : Math.round(Math.min(100, 95 * capeTerm * (0.5 + 0.5 * shearTerm)));
  const tornado = (ts < 30 || shear < 12) ? 0
    : Math.round(Math.min(100, 70 * shearTerm * Math.min(1, (cape - 300) / 1500)));
  const lightning = Math.round(Math.min(100, ts * 0.95));
  const flashFlood = Math.round(Math.min(100, ts * (0.5 + 0.5 * (1 - shearTerm))));
  const strongWinds = Math.round(Math.min(100, Math.max(ts * 0.4, gust > 30 ? (gust - 25) * 2 : 0)));
  const supercell = (ts < 45 || shear < 18) ? 0
    : Math.round(Math.min(100, (shear - 15) * 4 + (cape - 800) / 30));

  return {
    thunderstorm: ts,
    hail, tornado, lightning,
    sub: { tornado, hail, flashFlood, strongWinds, supercell },
    metrics: {
      cape,
      shear: Math.round(shear * 10) / 10,
      li: 5 - ts / 20,
      gust: Math.round(gust),
      precip: Math.round(ts * 0.4 * 10) / 10,
    },
  };
}

function interpAt(lat, lon, anchors, key) {
  const dists = anchors.map(a => {
    const dy = lat - a.lat, dx = lon - a.lon;
    return { v: a[key] || 0, d2: dy * dy + dx * dx };
  });
  for (const d of dists) if (d.d2 < 1e-6) return d.v;
  dists.sort((a, b) => a.d2 - b.d2);
  const local = dists.slice(0, 4);
  let num = 0, den = 0;
  for (const d of local) {
    const w = 1 / d.d2;
    num += w * d.v;
    den += w;
  }
  return den ? num / den : 0;
}

function diurnal(stepIdx) {
  const localHour = (stepIdx % STEPS_PER_DAY) * HOURS_PER_STEP;
  return 0.30 + 0.70 * Math.max(0, Math.cos((localHour - 15) / 24 * 2 * Math.PI));
}

function buildSummary(grid) {
  return [0, 1, 2, 3].map(d => {
    const ts = [], hl = [], tn = [], lg = [];
    const subT = [], subH = [], subF = [], subW = [], subS = [];
    const capes = [], shears = [], gusts = [];
    let stormyCells = 0;
    for (const p of grid) {
      const sc = p.perDay[d].scores;
      ts.push(sc.thunderstorm); hl.push(sc.hail); tn.push(sc.tornado); lg.push(sc.lightning);
      if (sc.thunderstorm >= 8) {
        stormyCells++;
        subT.push(sc.sub.tornado); subH.push(sc.sub.hail);
        subF.push(sc.sub.flashFlood); subW.push(sc.sub.strongWinds);
        subS.push(sc.sub.supercell);
        capes.push(sc.metrics.cape);
        shears.push(sc.metrics.shear);
        gusts.push(sc.metrics.gust);
      }
    }
    const p95 = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.95)]; };
    const p05 = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.05)]; };
    return {
      thunderstorm: p95(ts), hail: p95(hl), tornado: p95(tn), lightning: p95(lg),
      stormyCells, totalCells: grid.length,
      sub: {
        tornado:     p95(subT),
        hail:        p95(subH),
        flashFlood:  p95(subF),
        strongWinds: p95(subW),
        supercell:   p95(subS),
      },
      ranges: {
        cape:   { min: p05(capes),  max: p95(capes) },
        shear:  { min: p05(shears), max: p95(shears) },
        gust:   { min: p05(gusts),  max: p95(gusts) },
        precip: { min: 0, max: 0 },
        hailMm: { min: 0, max: Math.round((subH.length ? subH.reduce((m, x) => (x > m ? x : m), 0) : 0) * 0.7) }
      }
    };
  });
}

function buildGridFromAnchors(anchorData, bbox, gridStep) {
  const coords = buildFullCoords(bbox, gridStep);
  const grid = [];
  for (const c of coords) {
    const day = idx => ({
      ts:    interpAt(c.lat, c.lon, anchorData, `d${idx}_ts`),
      cape:  interpAt(c.lat, c.lon, anchorData, `d${idx}_cape`),
      shear: interpAt(c.lat, c.lon, anchorData, `d${idx}_shear`),
      gust:  interpAt(c.lat, c.lon, anchorData, `d${idx}_gust`),
    });
    const days = [day(0), day(1), day(2), day(3)];

    const perStep = [];
    for (let s = 0; s < TOTAL_STEPS; s++) {
      const d = Math.floor(s / STEPS_PER_DAY);
      const diu = diurnal(s);
      const dd = days[d];
      perStep.push({
        scores: expandScores(
          dd.ts * diu,
          dd.cape * (0.4 + 0.6 * diu),
          dd.shear,
          dd.gust * (0.6 + 0.4 * diu)
        )
      });
    }
    const perDay = days.map(dd =>
      ({ scores: expandScores(dd.ts, dd.cape, dd.shear, dd.gust) })
    );
    grid.push({ lat: c.lat, lon: c.lon, perStep, perDay });
  }
  return grid;
}

// ── LLM call with internet search for real current weather data ──────────────
async function fetchGriddedForecast(regionLabel, anchors, today) {
  const dayDates = [0, 1, 2, 3].map(off => {
    const d = new Date(today + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + off);
    return d.toISOString().slice(0, 10);
  });

  const prompt = `You are an expert convective meteorologist. Today is ${today}. Search the web NOW for the latest NWP model data, synoptic charts, and thunderstorm outlooks for ${regionLabel} for the dates ${dayDates.join(', ')}.

Search for: current CAPE forecasts, wind shear forecasts, thunderstorm risk, convective outlooks, and any active severe weather warnings for ${regionLabel}.

Use the REAL current model data you find (GFS, ECMWF, UKMO, ESTOFEX, Met Office, etc.) to fill in accurate values for each anchor point.

For each anchor, return the PEAK values across the full 24-hour day (00Z-24Z):
- thunderstorm score 0-100 (0=none, 10=isolated, 25=scattered weak, 40=organised, 55=severe possible, 70=significant severe, 85+=extreme outbreak)
- CAPE in J/kg (peak daytime value)
- 0-6km bulk shear in m/s
- peak wind gust in mph

Physical constraints (HARD RULES — do not violate):
- Score ≥25 requires CAPE ≥250 J/kg
- Score ≥40 requires CAPE ≥500 J/kg  
- Score ≥55 requires CAPE ≥1000 J/kg AND shear ≥12 m/s
- Score ≥70 requires CAPE ≥1500 J/kg AND shear ≥18 m/s
- If CAPE is near 0, score must be near 0

Be ACCURATE to today's actual forecast, not climatology. If models show a genuine thunderstorm risk, reflect it. If it's a quiet spell, reflect that too.

Anchor locations for ${regionLabel}:
${anchors.map((a, i) => `${i + 1}. ${a.label} (lat:${a.lat}, lon:${a.lon})`).join('\n')}

Return exactly ${anchors.length} entries in the same order. This is a ${ANCHOR_COUNT}×${ANCHOR_COUNT} grid so spatial variation is important — do NOT return identical scores across all rows.`;

  const schema = {
    type: 'object',
    properties: {
      anchors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            lat: { type: 'number' }, lon: { type: 'number' },
            day1_score: { type: 'number' }, day1_cape: { type: 'number' }, day1_shear: { type: 'number' }, day1_gust: { type: 'number' },
            day2_score: { type: 'number' }, day2_cape: { type: 'number' }, day2_shear: { type: 'number' }, day2_gust: { type: 'number' },
            day3_score: { type: 'number' }, day3_cape: { type: 'number' }, day3_shear: { type: 'number' }, day3_gust: { type: 'number' },
            day4_score: { type: 'number' }, day4_cape: { type: 'number' }, day4_shear: { type: 'number' }, day4_gust: { type: 'number' },
          },
          required: ['lat', 'lon',
            'day1_score', 'day1_cape', 'day1_shear', 'day1_gust',
            'day2_score', 'day2_cape', 'day2_shear', 'day2_gust',
            'day3_score', 'day3_cape', 'day3_shear', 'day3_gust',
            'day4_score', 'day4_cape', 'day4_shear', 'day4_gust'],
        },
      },
      synoptic_summary: { type: 'string' },
    },
    required: ['anchors'],
  };

  try {
    // Use gemini_3_1_pro with internet search for real current NWP data
    const res = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: schema,
      add_context_from_internet: true,
      model: 'gemini_3_1_pro',
    });
    if (res?.anchors?.length) return res;
  } catch (e) {
    console.warn('[AI fallback] gemini+internet call failed:', e?.message, '— trying fallback model');
    // Fallback: try gemini_3_flash with internet (cheaper)
    try {
      const res2 = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: schema,
        add_context_from_internet: true,
        model: 'gemini_3_flash',
      });
      if (res2?.anchors?.length) return res2;
    } catch (e2) {
      console.warn('[AI fallback] gemini_3_flash also failed:', e2?.message);
    }
  }
  return null;
}

function cacheKeyFor(regionLabel, run) {
  const isEurope = /europe/i.test(regionLabel);
  const reg = isEurope ? 'eu' : 'uk';
  // v4: uses gemini+internet, 6x6 anchors for denser grid
  const dateKey = new Date(run).toISOString().slice(0, 13); // hour-level key
  return `ai-fallback-v4-internet-${reg}-${dateKey}`;
}

async function loadFromSharedCache(key) {
  try {
    const res = await base44.functions.invoke('aiForecastCache', { action: 'load', key });
    return res?.data?.found ? res.data.payload : null;
  } catch {
    return null;
  }
}

async function saveToSharedCache(key, payload) {
  try {
    await base44.functions.invoke('aiForecastCache', { action: 'save', key, payload });
  } catch (e) {
    console.warn('[AI fallback] save to shared cache failed:', e?.message);
  }
}

export async function fetchAIForecastFallback({ bbox, gridStep, run, regionLabel, onProgress }) {
  onProgress?.(0.02);
  const isEurope = /europe/i.test(regionLabel);
  const anchors = buildAnchors(bbox, isEurope);
  const today = new Date().toISOString().slice(0, 10);
  const key = cacheKeyFor(regionLabel, run);

  // 1. Try shared server cache first (instant if another user already ran it)
  onProgress?.(0.10);
  const cached = await loadFromSharedCache(key);
  if (cached?.grid?.length) {
    console.info('[AI fallback] HIT shared cache — instant load');
    onProgress?.(1);
    return cached;
  }

  // 2. Cold path — single fast LLM call
  onProgress?.(0.25);
  const response = await fetchGriddedForecast(regionLabel, anchors, today);
  onProgress?.(0.80);

  const aiAnchors = Array.isArray(response?.anchors) ? response.anchors : [];

  const physClamp = (ts, cape, shear) => {
    ts = Math.max(0, Math.min(100, Number(ts) || 0));
    cape = Math.max(0, Number(cape) || 0);
    shear = Math.max(0, Number(shear) || 0);
    if (ts >= 85 && (cape < 2500 || shear < 22)) ts = 70;
    if (ts >= 70 && (cape < 1500 || shear < 18)) ts = 55;
    if (ts >= 55 && (cape < 1000 || shear < 12)) ts = 40;
    if (ts >= 40 && cape < 500) ts = 25;
    if (ts >= 25 && cape < 250) ts = 15;
    return Math.round(ts);
  };

  const anchorData = anchors.map((a, idx) => {
    let match = aiAnchors.find(x =>
      Math.abs((x.lat ?? -999) - a.lat) < 0.5 &&
      Math.abs((x.lon ?? -999) - a.lon) < 0.5
    );
    if (!match && aiAnchors[idx]) match = aiAnchors[idx];

    const clamp = (v, mx = 100) => Math.max(0, Math.min(mx, Number(v) || 0));
    const d0_cape = clamp(match?.day1_cape, 5000), d0_shear = clamp(match?.day1_shear, 40);
    const d1_cape = clamp(match?.day2_cape, 5000), d1_shear = clamp(match?.day2_shear, 40);
    const d2_cape = clamp(match?.day3_cape, 5000), d2_shear = clamp(match?.day3_shear, 40);
    const d3_cape = clamp(match?.day4_cape, 5000), d3_shear = clamp(match?.day4_shear, 40);
    return {
      lat: a.lat, lon: a.lon, label: a.label,
      d0_ts: physClamp(match?.day1_score, d0_cape, d0_shear), d0_cape, d0_shear, d0_gust: clamp(match?.day1_gust, 120),
      d1_ts: physClamp(match?.day2_score, d1_cape, d1_shear), d1_cape, d1_shear, d1_gust: clamp(match?.day2_gust, 120),
      d2_ts: physClamp(match?.day3_score, d2_cape, d2_shear), d2_cape, d2_shear, d2_gust: clamp(match?.day3_gust, 120),
      d3_ts: physClamp(match?.day4_score, d3_cape, d3_shear), d3_cape, d3_shear, d3_gust: clamp(match?.day4_gust, 120),
    };
  });

  const grid = buildGridFromAnchors(anchorData, bbox, gridStep);
  const summary = buildSummary(grid);
  onProgress?.(0.95);

  const payload = {
    grid,
    summary,
    builtAt: Date.now(),
    source: 'ai-fallback',
    cellCount: grid.length,
    models: ['Gemini Pro + Live Web Search (NWP data)'],
    synopticSummary: response?.synoptic_summary || '',
    aiAnchorsReturned: aiAnchors.length,
    aiAnchorsRequested: anchors.length,
  };

  // 3. Save to shared cache so the next user gets it instantly
  saveToSharedCache(key, payload); // fire-and-forget
  onProgress?.(1);
  return payload;
}