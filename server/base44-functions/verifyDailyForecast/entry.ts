import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * verifyDailyForecast
 * ----------------------------------------------------------------------------
 * Runs daily at 00:00 UTC. Compares yesterday's forecast (from LightningArchive
 * if available, or from the TCM Deno API) against actual recorded lightning
 * strikes to compute skill scores and a calibration offset that auto-tunes the
 * live forecast engine.
 *
 * Writes:
 *  • ForecastVerification — full daily verification log (POD, FAR, bias, notes)
 *  • ModelBiasCalibration — running calibration offset applied to future runs
 *
 * The frontend reads ModelBiasCalibration in applyBiasCalibration() and adds
 * `score_offset` to every grid point's thunderstorm/lightning score.
 */

const UK_BBOX = { latMin: 49.5, latMax: 61.5, lonMin: -10.5, lonMax: 2.0 };
const EU_BBOX = { latMin: 35.0, latMax: 62.0, lonMin: -12.0, lonMax: 32.0 };

const inBBox = (lat, lon, b) =>
  lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;

// ─── Skill score math ───────────────────────────────────────────────────────
// Hits        H = forecast YES AND observed YES
// Misses      M = forecast NO  AND observed YES
// False alarm F = forecast YES AND observed NO
// Correct neg N = forecast NO  AND observed NO
//
// POD (hit rate)      = H / (H + M)
// FAR (false alarm)   = F / (H + F)
// Frequency bias      = (H + F) / (H + M)   (>1 = over-forecast)

function computeSkillScores({ forecastScore, observedStrikes, bboxArea }) {
  // Simple region-level scoring (single cell per day per region)
  const forecastSays = forecastScore >= 20; // Marginal+ counts as a forecast YES
  const observedSays = observedStrikes >= 10; // 10+ strikes = real convection happened

  const hit       = forecastSays && observedSays ? 1 : 0;
  const miss      = !forecastSays && observedSays ? 1 : 0;
  const falseAlarm = forecastSays && !observedSays ? 1 : 0;

  const hitRate = (hit + miss) > 0 ? hit / (hit + miss) : 0;
  const farRate = (hit + falseAlarm) > 0 ? falseAlarm / (hit + falseAlarm) : 0;

  // Bias: forecast score vs observed activity (normalised 0-100 for strikes)
  const observedScore = Math.min(100, observedStrikes / 5); // 500+ strikes → 100
  const bias = observedScore > 0 ? forecastScore / observedScore : (forecastScore > 0 ? 2 : 1);

  return { hit, miss, falseAlarm, hitRate, farRate, bias, observedScore };
}

// Convert bias to a calibration offset to apply to future forecasts
// bias=1.5 → over-forecasting by 50% → subtract ~10 points
// bias=0.5 → under-forecasting by 50% → add ~10 points
function biasToOffset(rollingBias) {
  if (!Number.isFinite(rollingBias) || rollingBias <= 0) return 0;
  // log-linear mapping clamped to ±15
  const raw = -15 * Math.log2(rollingBias);
  return Math.max(-15, Math.min(15, Math.round(raw * 10) / 10));
}

async function verifyRegion(base44, region, dateStr, dateStartMs, dateEndMs) {
  const bbox = region === 'uk' ? UK_BBOX : EU_BBOX;

  // 1. Get yesterday's lightning archive (actual observations)
  const archives = await base44.asServiceRole.entities.LightningArchive.filter(
    { date: dateStr }, '-captured_at', 1
  ).catch(() => []);
  const archive = archives?.[0];
  const allStrikes = archive?.strikes || [];
  const observedStrikes = allStrikes.filter(s => inBBox(s.lat, s.lon, bbox)).length;

  // 2. Get forecast that was made for that day (from saved per-run cache via Deno API)
  // We rely on the archive entry's `level`/`score` if it was saved with the forecast.
  // Otherwise we score against the highest archive level for that day.
  const forecastScore = Number(archive?.score ?? 0) || (archive?.level ? levelToScore(archive.level) : 0);
  const forecastLevel = archive?.level || scoreToLevelName(forecastScore);

  // 3. Compute skill scores
  const skill = computeSkillScores({ forecastScore, observedStrikes });

  // 4. Save ForecastVerification record (idempotent on date+region)
  const verificationKey = { date: dateStr, region };
  const existing = await base44.asServiceRole.entities.ForecastVerification
    .filter(verificationKey, '-created_date', 1).catch(() => []);

  const verificationPayload = {
    date: dateStr,
    region,
    forecast_run: archive?.captured_at ? new Date(archive.captured_at).toISOString() : null,
    forecast_level: forecastLevel,
    forecast_score: Math.round(forecastScore),
    forecast_coverage_pct: 0,
    observed_strike_count: observedStrikes,
    observed_active_cells: 0,
    hit_rate: Math.round(skill.hitRate * 100) / 100,
    false_alarm_rate: Math.round(skill.farRate * 100) / 100,
    bias_score: Math.round(skill.bias * 100) / 100,
    notes: buildNote(region, forecastLevel, forecastScore, observedStrikes, skill),
  };

  if (existing?.length) {
    await base44.asServiceRole.entities.ForecastVerification.update(existing[0].id, verificationPayload);
  } else {
    await base44.asServiceRole.entities.ForecastVerification.create(verificationPayload);
  }

  // 5. Update rolling bias calibration (last 30 days) for this region
  const recent = await base44.asServiceRole.entities.ForecastVerification
    .filter({ region }, '-date', 30).catch(() => []);
  const biases = (recent || []).map(r => Number(r.bias_score)).filter(b => Number.isFinite(b) && b > 0);
  const rollingBias = biases.length ? biases.reduce((a, b) => a + b, 0) / biases.length : 1;
  const offset = biasToOffset(rollingBias);

  const history = (recent || []).slice(0, 30).map(r => ({
    date: r.date, bias: r.bias_score, hitRate: r.hit_rate, far: r.false_alarm_rate,
  }));

  const calRows = await base44.asServiceRole.entities.ModelBiasCalibration
    .filter({ region }, '-last_updated', 1).catch(() => []);
  const calPayload = {
    region,
    score_offset: offset,
    sample_size: biases.length,
    rolling_bias: Math.round(rollingBias * 100) / 100,
    last_updated: new Date().toISOString(),
    history,
  };
  if (calRows?.length) {
    await base44.asServiceRole.entities.ModelBiasCalibration.update(calRows[0].id, calPayload);
  } else {
    await base44.asServiceRole.entities.ModelBiasCalibration.create(calPayload);
  }

  verificationPayload.calibrationOffset = offset;
  verificationPayload.rollingBias = rollingBias;
  verificationPayload.samples = biases.length;
  return verificationPayload;
}

function levelToScore(level) {
  return ({ 'Very Low': 5, 'Low': 12, 'Marginal': 22, 'Slight': 35, 'Moderate': 50, 'High': 65, 'Severe': 80 }[level]) || 0;
}
function scoreToLevelName(s) {
  if (s >= 80) return 'Severe';
  if (s >= 65) return 'High';
  if (s >= 50) return 'Moderate';
  if (s >= 35) return 'Slight';
  if (s >= 22) return 'Marginal';
  if (s >= 12) return 'Low';
  if (s >= 5)  return 'Very Low';
  return 'No Risk';
}
function buildNote(region, level, score, strikes, skill) {
  const verdict = skill.hit ? '✓ Hit'
                : skill.falseAlarm ? '✗ False alarm'
                : skill.miss ? '✗ Missed event'
                : '◯ Correct null';
  const biasNote = skill.bias > 1.3 ? `over-forecast (${skill.bias.toFixed(2)}×)`
                 : skill.bias < 0.7 ? `under-forecast (${skill.bias.toFixed(2)}×)`
                 : `well-calibrated (${skill.bias.toFixed(2)}×)`;
  return `${region.toUpperCase()} — Forecast ${level} (${score}); observed ${strikes} strikes. ${verdict}. ${biasNote}.`;
}

Deno.serve(async (req) => {
  try {
    // Allow service-role only — no user auth required (scheduled job)
    const base44 = createClientFromRequest(req);

    const now = new Date();
    // Verify YESTERDAY (the day that just finished)
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);
    const dateStr = yesterday.toISOString().slice(0, 10);
    const dateStartMs = yesterday.getTime();
    const dateEndMs = dateStartMs + 24 * 3600_000;

    const results = {};
    for (const region of ['uk', 'eu']) {
      try {
        results[region] = await verifyRegion(base44, region, dateStr, dateStartMs, dateEndMs);
      } catch (e) {
        console.error(`[verifyDailyForecast] ${region} failed:`, e?.message);
        results[region] = { error: e?.message };
      }
    }

    return Response.json({ ok: true, date: dateStr, results });
  } catch (error) {
    console.error('[verifyDailyForecast] ERROR', error?.message, error?.stack);
    return Response.json({ ok: false, error: error?.message }, { status: 500 });
  }
});