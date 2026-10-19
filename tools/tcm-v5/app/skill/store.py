"""The skill database, and how it answers a question it has too little data
to answer directly.

THE PROBLEM
-----------
The question the weighting engine asks is very specific:

    How well has ECMWF forecast CAPE, over southern England, at 0-12 hours,
    in summer, in a Spanish plume?

The honest answer is usually "we have seven cases". Seven cases give an
estimate with an enormous confidence interval, and using it raw would let
noise override thousands of broader observations -- which is exactly how
adaptive weighting systems produce worse forecasts than equal weighting.

THE APPROACH: HIERARCHICAL SHRINKAGE
------------------------------------
Every context sits in a hierarchy, each level broader than the last:

    model x variable x region x lead x season x regime      most specific
    model x variable x region x lead x season
    model x variable x region x lead
    model x variable x region
    model x variable
    model                                                   most general

An estimate at any level is shrunk towards its parent by

    estimate = (n * sample + k * parent) / (n + k)

with a single documented constant `SHRINKAGE_N`: the sample size at which an
estimate carries equal weight with its parent. That is the ONLY free
parameter in the whole scheme, it has a plain-language meaning, and it is
stated on every result. With seven cases and k = 30, the specific estimate
contributes 19% and the broader context 81%; by four hundred cases it
contributes 93% and has effectively taken over.

This is deliberately NOT a fallback ladder that jumps to a parent when the
sample is "too small". A hard cut-off makes skill jump discontinuously as
one more case arrives, which shows up as a visible seam in the weights.
Shrinkage is continuous.

SPACE IS CONTINUOUS TOO
-----------------------
Section 13: meteorological skill does not obey county boundaries. Region is
available as a coarse key, but `local_estimate` weights each verification
pair by distance through a Gaussian kernel instead, so skill varies smoothly
and a point near a regional boundary is not forced to pick a side.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field as dc_field
from datetime import datetime

import numpy as np

from . import metrics as mx
from .identity import ModelIdentity
from .verification import (
    ForecastKind, SkillQuery, VerificationPair, haversine_km, lead_band_of,
    season_of,
)

log = logging.getLogger(__name__)

#: The sample size at which an estimate carries equal weight with its
#: parent context. THE ONLY free parameter in the shrinkage scheme.
#:
#: 30 is chosen for what it means rather than by fitting: below about thirty
#: cases a verification statistic over UK convection is dominated by which
#: particular days happened to fall in the sample, and above it the sample
#: starts to describe the model. It is exposed on every estimate so its
#: effect is visible, and `sensitivity()` shows what other values would give.
SHRINKAGE_N = 30.0

#: Length scale of the spatial kernel, km. Set to the scale over which UK
#: model skill plausibly varies -- terrain and coastal effects operate over
#: tens of kilometres, synoptic skill over hundreds. 150 km is between them
#: and deliberately wide: too narrow and every point sees only a handful of
#: stations.
SPATIAL_KERNEL_KM = 150.0

#: Below this effective sample the estimate is reported as unreliable
#: whatever its value.
MIN_EFFECTIVE_SAMPLE = 5.0


def _country_of(region: str) -> str:
    """The country a region belongs to, for hierarchical fallback.

    Empty when `region` is not one of the declared regions -- which includes
    the case where it IS already a country, so the chain terminates instead
    of looping.
    """
    from ..spatial import regional
    return regional.parent_of(region)


@dataclass(frozen=True, slots=True)
class SkillContext:
    """The conditions a skill estimate applies to."""

    model: str
    variable: str
    region: str = ""
    lead_band: tuple[float, float] | None = None
    season: str = ""
    regime: str = ""

    @property
    def specificity(self) -> int:
        """How many conditions are pinned. Higher is more specific."""
        return sum([
            bool(self.region), self.lead_band is not None,
            bool(self.season), bool(self.regime),
        ])

    def parent(self) -> "SkillContext | None":
        """The next broader context, dropping the most specific condition.

        The order -- regime, then season, then region, then lead -- is a
        judgement about which condition matters most and is therefore worth
        keeping longest. Lead time survives to the end because skill decays
        with lead for every model and every variable, so pooling across
        leads is the most damaging generalisation of the four.
        """
        if self.regime:
            return SkillContext(self.model, self.variable, self.region,
                                self.lead_band, self.season)
        if self.season:
            return SkillContext(self.model, self.variable, self.region,
                                self.lead_band)
        if self.region:
            # A region generalises to its COUNTRY before it generalises to
            # nothing. Dropping straight from "east_anglia" to the whole
            # domain throws away the England-wide evidence that sits between
            # them, and that intermediate pool is exactly what `Region.parent`
            # was declared for -- the docstring there calls it "the parent
            # Stage 6's hierarchical shrinkage falls back towards", and until
            # now nothing fell back towards it.
            country = _country_of(self.region)
            if country and country != self.region:
                return SkillContext(self.model, self.variable, country,
                                    self.lead_band, self.season)
            return SkillContext(self.model, self.variable, "",
                                self.lead_band)
        if self.lead_band is not None:
            return SkillContext(self.model, self.variable)
        if self.variable:
            return SkillContext(self.model, "")
        return None

    def chain(self) -> list["SkillContext"]:
        """This context and every broader one, most specific first."""
        out = [self]
        current = self
        while (current := current.parent()) is not None:
            out.append(current)
        return out

    @property
    def key(self) -> str:
        parts = [self.model, self.variable or "*"]
        parts.append(self.region or "*")
        parts.append(
            f"{self.lead_band[0]:.0f}-{self.lead_band[1]:.0f}h"
            if self.lead_band else "*"
        )
        parts.append(self.season or "*")
        parts.append(self.regime or "*")
        return "|".join(parts)

    def to_dict(self) -> dict:
        return {
            "model": self.model, "variable": self.variable or None,
            "region": self.region or None,
            "lead_band": list(self.lead_band) if self.lead_band else None,
            "season": self.season or None, "regime": self.regime or None,
            "specificity": self.specificity, "key": self.key,
        }


@dataclass(slots=True)
class SkillEstimate:
    """A skill value, its sample, and how much of it is borrowed.

    `borrowed_fraction` is the headline honesty number: 0 means the estimate
    is entirely this context's own evidence, 1 means it is entirely its
    parent's and the specific context contributed nothing.
    """

    context: SkillContext
    metric: str
    #: The shrunk estimate actually used.
    value: float | None
    #: The raw sample statistic before shrinkage, for comparison.
    raw_value: float | None
    n: int
    #: Effective sample after shrinkage: n + SHRINKAGE_N.
    effective_n: float
    #: Fraction of the estimate that came from broader contexts.
    borrowed_fraction: float
    #: Standard error of the estimate, where computable.
    standard_error: float | None = None
    #: Which contexts contributed, most specific first.
    chain: tuple[str, ...] = ()
    reason: str = ""
    flags: tuple[str, ...] = ()

    @property
    def available(self) -> bool:
        return self.value is not None and math.isfinite(self.value)

    @property
    def reliable(self) -> bool:
        """Whether this estimate should be leaned on at all."""
        return self.available and self.n >= MIN_EFFECTIVE_SAMPLE

    def to_dict(self) -> dict:
        return {
            "context": self.context.to_dict(),
            "metric": self.metric,
            "value": round(self.value, 6) if self.available else None,
            "raw_value": (
                round(self.raw_value, 6)
                if self.raw_value is not None and math.isfinite(self.raw_value)
                else None
            ),
            "n": self.n,
            "effective_n": round(self.effective_n, 2),
            "borrowed_fraction": round(self.borrowed_fraction, 4),
            "standard_error": (
                round(self.standard_error, 6)
                if self.standard_error is not None else None
            ),
            "shrinkage_n": SHRINKAGE_N,
            "chain": list(self.chain),
            "reliable": self.reliable,
            "reason": self.reason,
            "flags": list(self.flags),
        }


@dataclass(slots=True)
class SkillStore:
    """Verification pairs, and the skill estimates derived from them.

    Deliberately in memory and deliberately simple. The point of Stage 6 is
    the statistical discipline, not the storage engine; swapping this for a
    database changes `pairs_for` and nothing else.
    """

    pairs: list[VerificationPair] = dc_field(default_factory=list)

    def add(self, pair: VerificationPair) -> None:
        self.pairs.append(pair)

    def extend(self, pairs) -> None:
        self.pairs.extend(pairs)

    def __len__(self) -> int:
        return len(self.pairs)

    # -- retrieval ---------------------------------------------------------

    def pairs_for(
        self, context: SkillContext, as_of: datetime,
        *, window_days: int | None = None,
    ) -> list[VerificationPair]:
        """Every pair matching a context that was known by `as_of`.

        The `as_of` filter is applied FIRST and unconditionally. Everything
        else narrows an already-legitimate set.
        """
        out = []
        for pair in self.pairs:
            if not pair.known_by(as_of):
                continue
            if window_days is not None:
                age = (as_of - pair.available_at).days
                if age > window_days:
                    continue
            forecast = pair.forecast
            if forecast.model.key != context.model:
                continue
            if context.variable and forecast.variable != context.variable:
                continue
            if context.lead_band is not None:
                low, high = context.lead_band
                if not (low <= forecast.lead_hours <= high):
                    continue
            if context.season and season_of(forecast.valid_time) != \
                    context.season:
                continue
            if context.regime and forecast.regime != context.regime:
                continue
            if context.region and _region_of(pair) != context.region:
                continue
            out.append(pair)
        return out

    # -- estimation --------------------------------------------------------

    def estimate(
        self, context: SkillContext, as_of: datetime, *,
        metric: str = "mae", kind: ForecastKind = ForecastKind.CONTINUOUS,
        window_days: int | None = None, shrinkage: float | None = None,
    ) -> SkillEstimate:
        """A hierarchically shrunk skill estimate for `context`.

        Walks the context chain from most specific to most general,
        computing the raw statistic at each level, then folds them together
        from the top down so each level is shrunk towards the one above it.
        """
        k = SHRINKAGE_N if shrinkage is None else float(shrinkage)
        chain = context.chain()
        levels: list[tuple[SkillContext, float | None, int]] = []
        for level in chain:
            pairs = self.pairs_for(level, as_of, window_days=window_days)
            value, n = _statistic(pairs, metric, kind)
            levels.append((level, value, n))

        # Fold from the broadest level downward, so each estimate is shrunk
        # towards an already-shrunk parent rather than towards a raw one.
        running: float | None = None
        for level, value, n in reversed(levels):
            if value is None or n == 0:
                continue
            if running is None:
                running = value
                continue
            weight = n / (n + k)
            running = weight * value + (1.0 - weight) * running

        own_value, own_n = levels[0][1], levels[0][2]
        if running is None:
            return SkillEstimate(
                context=context, metric=metric, value=None, raw_value=None,
                n=0, effective_n=0.0, borrowed_fraction=1.0,
                chain=tuple(c.key for c in chain),
                reason=(
                    "no verification pairs for this model and variable at "
                    "any level of the hierarchy, as of "
                    f"{as_of:%Y-%m-%d %H:%M}"
                ),
            )

        borrowed = 1.0 - (own_n / (own_n + k)) if own_n else 1.0
        flags: list[str] = []
        if own_n == 0:
            flags.append(
                "no evidence at this exact context; the estimate is entirely "
                "borrowed from broader contexts"
            )
        elif own_n < MIN_EFFECTIVE_SAMPLE:
            flags.append(
                f"only {own_n} case(s) at this exact context, so "
                f"{borrowed:.0%} of the estimate is borrowed"
            )

        return SkillEstimate(
            context=context, metric=metric, value=float(running),
            raw_value=own_value, n=int(own_n),
            effective_n=float(own_n) + k,
            borrowed_fraction=round(borrowed, 4),
            standard_error=_standard_error(
                self.pairs_for(context, as_of, window_days=window_days),
                metric,
            ),
            chain=tuple(
                f"{c.key} (n={n})" for c, _, n in levels
            ),
            flags=tuple(flags),
        )

    def local_estimate(
        self, context: SkillContext, as_of: datetime,
        latitude: float, longitude: float, *,
        metric: str = "mae", kernel_km: float = SPATIAL_KERNEL_KM,
        window_days: int | None = None,
    ) -> SkillEstimate:
        """Distance-weighted skill at a point, rather than by region.

        Every pair contributes with weight exp(-(d/L)^2 / 2), so nearby
        verification dominates and distant verification still contributes
        rather than being discarded at an arbitrary boundary.

        Section 13: meteorological skill does not obey administrative
        borders, and a region-keyed estimate makes it jump across them.
        """
        spatial = SkillContext(
            context.model, context.variable, "", context.lead_band,
            context.season, context.regime,
        )
        pairs = self.pairs_for(spatial, as_of, window_days=window_days)
        if not pairs:
            return self.estimate(
                context, as_of, metric=metric, window_days=window_days,
            )

        errors = []
        weights = []
        for pair in pairs:
            distance = haversine_km(
                latitude, longitude,
                pair.observation.latitude, pair.observation.longitude,
            )
            weight = math.exp(-0.5 * (distance / kernel_km) ** 2)
            if weight < 1e-4:
                continue
            errors.append(_pair_statistic(pair, metric))
            weights.append(weight)

        if not errors:
            return self.estimate(
                context, as_of, metric=metric, window_days=window_days,
            )

        errors_array = np.array(errors, dtype="float64")
        weights_array = np.array(weights, dtype="float64")
        ok = np.isfinite(errors_array)
        errors_array, weights_array = errors_array[ok], weights_array[ok]
        if errors_array.size == 0:
            return self.estimate(
                context, as_of, metric=metric, window_days=window_days,
            )

        total = float(weights_array.sum())
        local = float((errors_array * weights_array).sum() / total)

        # The effective sample is the KISH effective size, not the count:
        # fifty pairs all 400 km away are worth far less than five nearby.
        effective = float(total ** 2 / (weights_array ** 2).sum())

        parent = self.estimate(
            context, as_of, metric=metric, window_days=window_days,
        )
        if parent.available:
            weight = effective / (effective + SHRINKAGE_N)
            value = weight * local + (1.0 - weight) * parent.value
            borrowed = 1.0 - weight
        else:
            value, borrowed = local, 0.0

        return SkillEstimate(
            context=context, metric=metric, value=value, raw_value=local,
            n=int(errors_array.size), effective_n=effective + SHRINKAGE_N,
            borrowed_fraction=round(borrowed, 4),
            standard_error=(
                float(np.std(errors_array) / math.sqrt(effective))
                if effective > 1 else None
            ),
            chain=(f"spatial kernel {kernel_km:.0f} km",) + parent.chain,
            flags=(
                f"effective sample {effective:.1f} from "
                f"{errors_array.size} pairs weighted by distance",
            ),
        )

    def sensitivity(
        self, context: SkillContext, as_of: datetime, *, metric: str = "mae",
    ) -> dict:
        """What the estimate would be for other shrinkage strengths.

        Exposed because `SHRINKAGE_N` is the scheme's only free parameter
        and its influence should be visible rather than asserted.
        """
        # The strength is PASSED, never assigned to the module global.
        # Reassigning it here was a live concurrency bug: this method is
        # reachable from a FastAPI request handler
        # (`api/routes/skill.py`) while the APScheduler worker is computing
        # weights for a forecast cycle in another thread, so hitting the
        # diagnostic endpoint could silently rebuild an operational
        # forecast's weights at k=0 or k=100.
        out = {}
        for candidate in (0.0, 10.0, 30.0, 100.0):
            estimate = self.estimate(
                context, as_of, metric=metric, shrinkage=candidate
            )
            out[f"k={candidate:.0f}"] = (
                round(estimate.value, 6) if estimate.available else None
            )
        out["note"] = (
            "k=0 uses the specific sample alone, however small; large k "
            "trusts the broader context. The default is 30"
        )
        return out


def _statistic(
    pairs: list[VerificationPair], metric: str, kind: ForecastKind
) -> tuple[float | None, int]:
    """The raw metric over a set of pairs."""
    if not pairs:
        return None, 0
    forecasts = [p.forecast.value for p in pairs]
    observations = [p.observation.value for p in pairs]
    results = mx.evaluate(forecasts, observations, kind)
    result = results.get(metric)
    if result is None or not result.available:
        return None, len(pairs)
    return float(result.value), int(result.n)


def _pair_statistic(pair: VerificationPair, metric: str) -> float:
    """The per-pair contribution to a metric, for kernel weighting."""
    error = pair.error
    if metric == "mae":
        return abs(error)
    if metric == "rmse":
        return error ** 2
    if metric == "bias":
        return error
    if metric == "brier_score":
        return error ** 2
    return abs(error)


def _standard_error(
    pairs: list[VerificationPair], metric: str
) -> float | None:
    if len(pairs) < 2:
        return None
    values = np.array(
        [_pair_statistic(p, metric) for p in pairs], dtype="float64"
    )
    values = values[np.isfinite(values)]
    if values.size < 2:
        return None
    return float(np.std(values, ddof=1) / math.sqrt(values.size))


#: How far outside every region a point may sit and still be attributed to
#: the nearest one, in degrees. Beyond this it is genuinely somewhere else
#: and "other" is the honest answer.
_NEAREST_REGION_LIMIT_DEG = 1.5


def region_of(latitude: float, longitude: float) -> str:
    """Coarse region for a point.

    A convenience for reporting and a coarse grouping key -- NOT the primary
    spatial mechanism. Boundaries are rectangles and the atmosphere ignores
    them; `SkillStore.local_estimate` is the route that treats space as
    continuous.

    THIS DELEGATES TO THE STAGE 8 REGIONS RATHER THAN DEFINING ITS OWN.
    It used to carry a second, independent table of six boxes, and the two
    definitions disagreed: that table started Scotland at 56N while its
    northern-England box reached to 56N and only as far west as -4.0, so
    Glasgow and Ayr fell through the gap into "other" while Edinburgh and
    Dumfries were filed under northern_england. Norwich fell in no box at
    all. Since `region` is a stratification key for learned model skill,
    those cases were being pooled with the wrong population -- and Scotland's
    own pool was missing its largest city.

    One definition, in `spatial.regional`, now serves both.
    """
    from ..spatial import regional

    region = regional.region_of(longitude, latitude)
    if region is not None:
        return region.name

    # Outside every box. A point just off the edge -- an offshore verification
    # site, an island -- belongs with its nearest region far more than it
    # belongs in an "other" bucket shared with everywhere else.
    best, best_distance = "", float("inf")
    for candidate in regional.REGIONS:
        dx = max(candidate.lon_min - longitude, 0.0,
                 longitude - candidate.lon_max)
        dy = max(candidate.lat_min - latitude, 0.0,
                 latitude - candidate.lat_max)
        # Longitude compressed to ground distance, so "nearest" means
        # nearest on the ground rather than nearest in degrees.
        dx *= math.cos(math.radians(latitude))
        distance = math.hypot(dx, dy)
        if distance < best_distance:
            best, best_distance = candidate.name, distance
    if best and best_distance <= _NEAREST_REGION_LIMIT_DEG:
        return best
    return "other"


def _region_of(pair: VerificationPair) -> str:
    return region_of(pair.forecast.latitude, pair.forecast.longitude)


def context_for(
    model: ModelIdentity, variable: str, *, latitude: float | None = None,
    longitude: float | None = None, lead_hours: float | None = None,
    valid_time: datetime | None = None, regime: str = "",
) -> SkillContext:
    """Build the most specific context the available information supports."""
    return SkillContext(
        model=model.key,
        variable=variable,
        region=(
            region_of(latitude, longitude)
            if latitude is not None and longitude is not None else ""
        ),
        lead_band=lead_band_of(lead_hours) if lead_hours is not None else None,
        season=season_of(valid_time) if valid_time is not None else "",
        regime=regime,
    )
