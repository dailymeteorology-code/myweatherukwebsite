"""Model skill, reliability and adaptive weights.

Stage 6. Exposes what the platform knows about how well each NWP source has
performed, and the weights that knowledge produces for a given task, place,
time and regime.

There is no forecast here. Weights are not probabilities, and nothing on
these routes combines the specialist engine outputs — that is the aggregation
stage.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query

from ...skill import agreement as ag
from ...skill import eligibility as el
from ...skill import identity as ident
from ...skill import store as sk_store
from ...skill import weights as wt

router = APIRouter(tags=["skill"])

#: The platform's live skill store. Empty until verification accumulates,
#: and every route says so rather than implying learned weights exist.
STORE = sk_store.SkillStore()


@router.get("/skill/models")
def models() -> dict:
    """Every model the weighting framework can represent, and its lineage."""
    known = {
        key: model.to_dict() for key, model in ident.KNOWN_MODELS.items()
    }
    families: dict[str, list[str]] = {}
    for key, model in ident.KNOWN_MODELS.items():
        families.setdefault(model.family.value, []).append(key)
    return {
        "count": len(known),
        "models": known,
        "families": families,
        "note": (
            "registration does NOT give a model skill. Skill is earned "
            "through verification; this only records what the framework "
            "knows a model is and which other models it is correlated with"
        ),
    }


@router.get("/skill/independence")
def independence(
    models: str = Query(..., description="comma-separated platform model ids"),
) -> dict:
    """How many independent opinions a set of models actually represents."""
    requested = [m.strip() for m in models.split(",") if m.strip()]
    identities = [ident.identify(m) for m in requested]
    effective, detail = ident.effective_independent_count(identities)
    return {
        "requested": requested,
        "effective_independent": effective,
        "detail": detail,
    }


@router.get("/skill/status")
def status() -> dict:
    """What the store actually holds. Deliberately blunt about emptiness."""
    trained = len(STORE) > 0
    by_model: dict[str, int] = {}
    for pair in STORE.pairs:
        key = pair.forecast.model.key
        by_model[key] = by_model.get(key, 0) + 1
    return {
        "verification_pairs": len(STORE),
        "has_learned_skill": trained,
        "pairs_by_model": dict(sorted(by_model.items())),
        "shrinkage_n": sk_store.SHRINKAGE_N,
        "spatial_kernel_km": sk_store.SPATIAL_KERNEL_KM,
        "weighting_version": wt.WEIGHTING_VERSION,
        "reliability_maps": [m.value for m in wt.ReliabilityMap],
        "default_reliability_map": wt.DEFAULT_MAP.value,
        "state": (
            "learned weights available" if trained else
            "NO verification has been accumulated yet. Any weights requested "
            "now fall back to the cold-start prior, are flagged as such, and "
            "carry maximum uncertainty. They are not learned"
        ),
    }


@router.get("/skill/estimate")
def estimate(
    model: str = Query(..., description="platform model id"),
    variable: str = Query(...),
    region: str = Query(""),
    season: str = Query(""),
    regime: str = Query(""),
    lead_hours: float | None = Query(None),
    metric: str = Query("mae"),
    as_of: str | None = Query(
        None, description="ISO time; omit for now. Skill is computed using "
                          "only evidence available at this time"
    ),
) -> dict:
    """A hierarchically shrunk skill estimate, with its borrowing exposed."""
    identity = ident.identify(model)
    try:
        when = (
            datetime.fromisoformat(as_of.replace("Z", "+00:00")) if as_of
            else datetime.now(timezone.utc)
        )
    except ValueError:
        raise HTTPException(400, f"could not parse as_of {as_of!r}") from None

    from ...skill.verification import lead_band_of
    context = sk_store.SkillContext(
        model=identity.key, variable=variable, region=region,
        lead_band=lead_band_of(lead_hours) if lead_hours is not None else None,
        season=season, regime=regime,
    )
    result = STORE.estimate(context, when, metric=metric)
    payload = result.to_dict()
    payload["sensitivity_to_shrinkage"] = STORE.sensitivity(
        context, when, metric=metric
    )
    return payload


@router.post("/skill/weights")
def weights(payload: dict) -> dict:
    """Weights for one task, place and time.

    Body:
        task, variable, valid_time, models[], regime, latitude, longitude,
        lead_hours, forecasts{model: value} (optional, for agreement)
    """
    required = ("task", "variable", "valid_time", "models")
    missing = [k for k in required if k not in payload]
    if missing:
        raise HTTPException(400, f"missing fields: {', '.join(missing)}")

    try:
        valid_time = datetime.fromisoformat(
            str(payload["valid_time"]).replace("Z", "+00:00")
        )
    except ValueError:
        raise HTTPException(400, "could not parse valid_time") from None

    as_of_raw = payload.get("as_of")
    try:
        as_of = (
            datetime.fromisoformat(str(as_of_raw).replace("Z", "+00:00"))
            if as_of_raw else datetime.now(timezone.utc)
        )
    except ValueError:
        raise HTTPException(400, "could not parse as_of") from None

    identities = [ident.identify(m) for m in payload["models"]]
    requirements = el.requirements_for_engine(payload["task"]) \
        if payload["task"] else el.TaskRequirements(
            variables=(payload["variable"],)
        )
    if not requirements.variables:
        requirements = el.TaskRequirements(variables=(payload["variable"],))

    available = set(payload.get("available_variables",
                                requirements.variables))
    candidates = [
        el.assess(
            identity, requirements, available_variables=available,
            run_time=as_of, now=as_of,
            forecast_hour=float(payload.get("lead_hours", 6.0)),
            levels=int(payload.get("levels", 9)),
            data_quality=float(payload.get("data_quality", 0.9)),
        )
        for identity in identities
    ]

    agreement = None
    raw = payload.get("forecasts")
    if isinstance(raw, dict) and raw:
        by_identity = {
            ident.identify(k): float(v) for k, v in raw.items()
        }
        agreement = ag.assess(payload["variable"], by_identity)

    result = wt.compute(
        payload["task"], payload["variable"], candidates, STORE,
        as_of=as_of, valid_time=valid_time,
        latitude=payload.get("latitude"), longitude=payload.get("longitude"),
        regime=payload.get("regime", ""),
        lead_hours=payload.get("lead_hours"),
        agreement=agreement,
    )
    return result.to_dict()


@router.post("/skill/agreement")
def agreement(payload: dict) -> dict:
    """The structure of disagreement among current forecasts.

    Body: variable, forecasts{model: value}, ensemble_members{system: [..]}
    """
    if "forecasts" not in payload or "variable" not in payload:
        raise HTTPException(400, "need variable and forecasts")
    by_identity = {
        ident.identify(k): float(v)
        for k, v in payload["forecasts"].items()
    }
    result = ag.assess(
        payload["variable"], by_identity,
        ensemble_members=payload.get("ensemble_members"),
    )
    return result.to_dict()
