"""V5 Stages 6-7 over the grid: per-source thunderstorm probability, multi-model
aggregation, hazards, nesting, confidence and uncertainty.

  tcm/stages.py      P = P(environment) x P(realisation | environment), per source
  tcm/aggregate.py   members -> system (mean probability, spread);
                     systems -> multi-model (LINEAR pooling, weighted)
  tcm/hazards.py     conditionals pooled with the same weights; nesting enforced
  tcm/uncertainty.py confidence (weakest link) and uncertainty (aleatoric/epistemic)

Weights here are per model and may vary per cell (a model that does not cover a cell
drops out there and the rest are renormalised, as V5 renormalises over contributing
systems).
"""
from __future__ import annotations

import numpy as np

from .core import NAN, finite
from app.tcm import stages as S  # noqa: E402
from app.tcm import uncertainty as U  # noqa: E402

HAZARD_ENGINE = {'lightning': 'lightning', 'hail': 'hail', 'severe_wind': 'severe_wind',
                 'downburst': 'downburst', 'heavy_rainfall': 'heavy_rainfall',
                 'tornado_environment': 'tornado_environment'}


def _link(link, x):
    """Link.__call__ over arrays (logistic in the potential, two anchors)."""
    from app.tcm.probability import logistic, logit
    a = logit(link.low_probability)
    b = logit(link.high_probability)
    slope = (b - a) / (link.high - link.low)
    x = np.asarray(x, dtype='float64')
    out = logistic(a + slope * (np.nan_to_num(x) - link.low))
    return np.where(finite(x), out, NAN)


def source_forecast(R):
    """forecast_source(): one source's probability, conditionals and regime."""
    pots = []
    for name in S.STAGE_A_ENGINES:
        e = R[name]
        v = np.where(e['has'], e['score'], NAN)
        pots.append(1.0 - v if name in S.INVERTED else v)
    n = np.sum([finite(p) for p in pots], axis=0)
    anyzero = np.any([finite(p) & (p <= 0.0) for p in pots], axis=0)
    with np.errstate(invalid='ignore', divide='ignore'):
        logs = np.sum([np.where(finite(p) & (p > 0), np.log(np.where(p > 0, p, 1.0)), 0.0) for p in pots], axis=0)
        env_pot = np.where(anyzero, 0.0, np.exp(logs / np.maximum(n, 1)))
    env_pot = np.where(n >= 2, np.clip(env_pot, 0.0, 1.0), NAN)
    ini = R['convective_initiation']
    real_pot = np.where(ini['has'], np.clip(ini['score'], 0.0, 1.0), NAN)
    env_p = _link(S.LINK_ENVIRONMENT, env_pot)
    real_p = _link(S.LINK_REALISATION, real_pot)
    prob = env_p * real_p
    cond = {}
    for hz, eng in HAZARD_ENGINE.items():
        e = R[eng]
        cond[hz] = np.where(e['has'], e['conditional'], NAN)
    cond['severe_hail'] = np.where(R['hail']['has'], R['hail']['significant'], NAN)
    reg = R['weather_regime']
    regime = {k: np.where(reg['has'], v, NAN) for k, v in reg['classes'].items()}
    csum = np.zeros(prob.shape)
    ccnt = np.zeros(prob.shape)
    for e in R.values():
        ok = finite(e['conf'])
        csum = csum + np.where(ok, e['conf'], 0.0)
        ccnt = ccnt + ok
    return dict(probability=prob, env_potential=env_pot, real_potential=real_pot, env_p=env_p, real_p=real_p,
                conditionals=cond, regime=regime, conf_sum=csum, conf_n=ccnt,
                forcing=R['convective_initiation']['forcing_available'])


def aggregate(sources, weights, *, lead_h, calibration='uncalibrated', history=0.3, within_extra=None):
    """sources: list of (model, member, source_forecast dict). weights: {model: scalar or
    array} (None -> 1, as V5's grid chain runs with no WeightSet). Returns arrays."""
    shape = sources[0][2]['probability'].shape
    by_model = {}
    for model, member, sf in sources:
        by_model.setdefault(model, []).append(sf)
    sysp, spread, has_sys = {}, {}, {}
    for model, group in by_model.items():
        ps = np.stack([g['probability'] for g in group])
        ok = finite(ps)
        k = ok.sum(0)
        mean = np.where(k > 0, np.where(ok, ps, 0).sum(0) / np.maximum(k, 1), NAN)
        sysp[model] = mean
        has_sys[model] = k > 0
        if len(group) > 1:
            dev = np.where(ok, (ps - mean) ** 2, 0).sum(0)
            spread[model] = np.where(k > 1, np.sqrt(dev / np.maximum(k - 1, 1)), NAN)
    w = {}
    for m in sysp:
        wm = 1.0 if weights is None else weights.get(m, 0.0)
        w[m] = np.where(has_sys[m], np.broadcast_to(np.asarray(wm, dtype='float64'), shape), 0.0)
    tot = sum(w.values())
    applied = {m: np.where(tot > 0, w[m] / np.where(tot > 0, tot, 1), 0.0) for m in w}
    prob = np.where(tot > 0, sum(applied[m] * np.nan_to_num(sysp[m]) for m in sysp), NAN)
    nsys = sum((applied[m] > 0).astype(int) for m in applied)
    if len(sysp) > 1:
        mean_p = np.where(nsys > 0, sum(np.where(applied[m] > 0, np.nan_to_num(sysp[m]), 0) for m in sysp) / np.maximum(nsys, 1), NAN)
        var = sum(np.where(applied[m] > 0, (np.nan_to_num(sysp[m]) - mean_p) ** 2, 0) for m in sysp)
        between = np.where(nsys > 1, np.sqrt(var / np.maximum(nsys - 1, 1)), NAN)
    else:
        between = np.full(shape, NAN)
    if spread:
        sp = np.stack([np.where(has_sys[m], spread[m], NAN) for m in spread])
        ok = finite(sp)
        within = np.where(ok.any(0), np.where(ok, sp, 0).sum(0) / np.maximum(ok.sum(0), 1), NAN)
    else:
        within = np.full(shape, NAN)
    if within_extra is not None:
        # NOVA: ensembles that carry no vertical profile cannot run the engines, but their
        # member spread is still within-model uncertainty; it joins any V5 member spread.
        we = np.asarray(within_extra, dtype='float64')
        within = np.where(finite(within) & finite(we), 0.5 * (within + we), np.where(finite(within), within, we))
    n_present = sum(has_sys[m].astype(int) for m in has_sys)
    n_excluded = len(by_model) - n_present

    # hazards: per-model mean conditional, pooled with the same applied weights
    hz = {}
    names = list(sources[0][2]['conditionals'])
    for name in names:
        num = np.zeros(shape)
        den = np.zeros(shape)
        cnt = np.zeros(shape)
        vals = {}
        for model, group in by_model.items():
            cs = np.stack([g['conditionals'][name] for g in group])
            ok = finite(cs)
            k = ok.sum(0)
            mc = np.where(k > 0, np.where(ok, cs, 0).sum(0) / np.maximum(k, 1), NAN)
            vals[model] = mc
            have = finite(mc)
            num = num + np.where(have, applied[model] * np.nan_to_num(mc), 0)
            den = den + np.where(have, applied[model], 0)
            cnt = cnt + have
        eq = np.where(cnt > 0, sum(np.where(finite(vals[m]), np.nan_to_num(vals[m]), 0) for m in vals) / np.maximum(cnt, 1), NAN)
        cond = np.where(den > 0, num / np.where(den > 0, den, 1), eq)
        cond = np.where(cnt > 0, cond, NAN)
        p = prob * cond
        hz[name] = {'conditional': cond, 'probability': p}
    # nesting: every hazard <= thunderstorm, severe hail <= hail
    for name in hz:
        p = hz[name]['probability']
        hz[name]['probability'] = np.where(finite(p) & finite(prob) & (p > prob + 1e-9), prob, p)
    sh, h = hz['severe_hail']['probability'], hz['hail']['probability']
    hz['severe_hail']['probability'] = np.where(finite(sh) & finite(h) & (sh > h + 1e-9), h, sh)

    # pooled regime (sources weighted by their system's applied weight)
    reg_names = list(sources[0][2]['regime'])
    pooled = {}
    for rn in reg_names:
        num = np.zeros(shape)
        den = np.zeros(shape)
        for model, member, sf in sources:
            a = sf['regime'][rn]
            ok = finite(a) & (applied[model] > 0)
            num = num + np.where(ok, applied[model] * np.nan_to_num(a), 0)
            den = den + np.where(ok, applied[model], 0)
        pooled[rn] = np.where(den > 0, num / np.where(den > 0, den, 1), NAN)
    ambiguity = _regime_ambiguity(pooled, shape)

    # confidence: weakest link
    csum = sum(sf['conf_sum'] for _, _, sf in sources)
    cn = sum(sf['conf_n'] for _, _, sf in sources)
    engine = np.where(cn > 0, csum / np.maximum(cn, 1), 0.3)
    coverage = n_present / max(len(by_model), 1)
    cal_conf = {'calibrated': 1.0, 'provisional': 0.5}.get(calibration, 0.25)
    lead = max(0.2, float(np.exp(-lead_h / 48.0)))
    comps = [coverage, engine, np.full(shape, history), np.full(shape, cal_conf), np.full(shape, lead)]
    confidence = np.minimum(U.MAX_CONFIDENCE, np.minimum.reduce([np.broadcast_to(c, shape) for c in comps]))

    # uncertainty: aleatoric (ensemble spread, marginality) and epistemic
    ens = np.where(finite(within), np.minimum(1.0, within / 0.25), 0.5)
    marg = np.where(finite(prob), 1.0 - 2.0 * np.abs(prob - 0.5), 0.0)
    aleatoric = np.sqrt((ens ** 2 + marg ** 2) / 2.0)
    dis = np.where(finite(between), np.minimum(1.0, between / 0.25), 0.6)
    missing = np.where(n_excluded > 0, np.minimum(1.0, n_excluded / np.maximum(n_present + n_excluded, 1)), 0.0)
    cal_unc = {'calibrated': 0.1, 'provisional': 0.4}.get(calibration, 0.7)
    epistemic = np.sqrt((dis ** 2 + missing ** 2 + ambiguity ** 2 + cal_unc ** 2) / 4.0)
    uncertainty = np.maximum(U.MIN_UNCERTAINTY, np.minimum(1.0, np.sqrt((epistemic ** 2 + aleatoric ** 2) / 2.0)))
    valid = finite(prob)
    return dict(probability=prob, hazards=hz, confidence=np.where(valid, confidence, NAN),
                uncertainty=np.where(valid, uncertainty, NAN), within=within, between=between,
                applied=applied, system_probability=sysp, regime=pooled, regime_ambiguity=ambiguity,
                n_systems=n_present)


def _regime_ambiguity(regime, shape):
    if len(regime) < 2:
        return np.zeros(shape)
    vals = np.stack([np.where(finite(v), v, -np.inf) for v in regime.values()])
    n_ok = finite(np.stack(list(regime.values()))).sum(0)
    lead = vals.max(0)
    idx = vals.argmax(0)
    close = np.zeros(shape)
    for i in range(vals.shape[0]):
        v = vals[i]
        close += ((i != idx) & np.isfinite(v) & (lead - v <= 0.15) & (v > 0.2))
    out = np.minimum(1.0, close / 3.0)
    out = np.where(lead <= 0, 1.0, out)
    return np.where(n_ok >= 2, out, 0.0)
