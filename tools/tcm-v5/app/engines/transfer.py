"""Transfer functions and composition rules.

This module is the architectural answer to "no hidden weights".

THE PROBLEM
-----------
Every convective forecasting system eventually needs to turn 1400 J/kg of
CAPE into a number between 0 and 1. The usual solution is

    risk = 0.4*CAPE_n + 0.3*shear_n + 0.2*RH_n + 0.1*forcing_n

which buries four unexplained coefficients where nobody can find them, cannot
be audited, and cannot be replaced by a trained model without rewriting
everything downstream.

THE APPROACH HERE
-----------------
Two separable pieces, each individually auditable:

**1. A `Transfer` per feature.** A documented, monotone map from a physical
value to [0, 1], anchored on values from the literature or from operational
practice. Each carries its anchors, its physical reasoning, its reference and
its limitations, and every one is printable and testable on its own.

**2. A composition rule with NO free parameters.** Features are combined by
one of five rules chosen for what the physics actually says:

    ingredients   geometric mean -- several ingredients ALL needed, each able
                  to limit the outcome, none able to substitute for another
    conditional   product        -- a genuine probability chain,
                                    P(A) * P(B|A)
    limiting      minimum        -- one hard bottleneck governs alone
    alternatives  noisy-OR       -- INDEPENDENT mechanisms, any sufficient
    dominant      maximum        -- CORRELATED measures of one driver, where
                                    the strongest governs and the rest add
                                    no independent evidence

The last two are easy to confuse and the difference is not stylistic.
Noisy-OR treats every input as fresh evidence, so three correlated
restatements of "the mid-levels are dry" compound into near-certainty. That
happened here: the entrainment engine returned 1.000 on a profile whose
mid-levels were 59% saturated, and drove the updraught engine to zero. Use
ALTERNATIVES only where the inputs are genuinely separate physical routes to
the same outcome, and compose each route's own ingredients FIRST.

None of these has a tunable coefficient. `ingredients` uses equal exponents
(1/n) deliberately: equal treatment is the ABSENCE of a claim about relative
importance, whereas any other exponents would be exactly the unexplained
coefficients this design exists to avoid. When training data later establish
that shear matters more than CAPE for a given outcome, that belongs in a
fitted model replacing the rule -- not in a number quietly edited here.

**Influence is read out, not put in.** After composing, each factor's
`influence` is derived FROM the result: for `ingredients` it is the share of
the total shortfall that factor accounts for. So influence describes what
happened rather than prescribing it, which is precisely what makes this not a
weighted sum wearing a disguise.

WHY GEOMETRIC MEAN RATHER THAN PRODUCT FOR INGREDIENTS
-------------------------------------------------------
A product of five factors each 0.8 gives 0.33, which asserts that five
independently-verified favourable ingredients make an unlikely event. They
are not independent probabilities -- they are partial memberships in
"favourable". The geometric mean of five 0.8s is 0.8, which says "uniformly
quite favourable", and it retains the essential property that any factor
going to zero takes the result to zero. Products are still used, under
`conditional`, where the quantities really are a probability chain.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field as dc_field
from enum import Enum

import numpy as np

from .result import Contribution


class Shape(str, Enum):
    """How a transfer maps value to [0, 1]."""

    #: Rises from 0 at `low` to 1 at `high`. Linear.
    RAMP = "ramp"
    #: Falls from 1 at `low` to 0 at `high`.
    INVERSE_RAMP = "inverse_ramp"
    #: Smooth rise; `low` maps to 0.1 and `high` to 0.9.
    LOGISTIC = "logistic"
    #: Smooth fall; `low` maps to 0.9 and `high` to 0.1.
    #:
    #: READ THAT AGAIN before writing anchors for a decreasing relationship.
    #: `low` and `high` are the anchor VALUES, named for the membership they
    #: produce, NOT for numeric ordering. For a decreasing relationship the
    #: value that should score HIGH goes in `low`:
    #:
    #:     dryness from RH:  low=30 (dry -> 0.9), high=70 (moist -> 0.1)
    #:     NOT               low=70, high=30, which silently scores a moist
    #:                       mid-level as maximum dilution
    #:
    #: Both orderings are numerically legal -- the formula handles either --
    #: so nothing raises. `tests/test_engines.py` probes every transfer at
    #: physically meaningful values instead, which is the only thing that
    #: actually catches an inversion.
    INVERSE_LOGISTIC = "inverse_logistic"
    #: 1 inside [`low`, `high`], falling to 0 over `margin` either side.
    #: For quantities with an optimum WINDOW rather than a direction.
    BAND = "band"


@dataclass(frozen=True, slots=True)
class Transfer:
    """One documented feature-to-membership map.

    Every instance must carry `reasoning` and `reference`. A transfer without
    a stated physical basis is exactly the arbitrary threshold this design
    forbids, and the constructor rejects it.
    """

    name: str
    feature: str
    unit: str
    shape: Shape
    low: float
    high: float
    #: Physical justification for the anchors. Required.
    reasoning: str
    #: Literature or operational source. Required.
    reference: str
    #: When this transfer misleads. Strongly encouraged.
    limitations: str = ""
    #: For BAND: the distance beyond each edge over which it falls to 0.
    #: Used for both sides unless `margin_low` overrides the lower one.
    margin: float = 0.0
    #: For BAND: a separate lower-side margin, where the two sides are not
    #: physically symmetric. They usually are not -- being below the window
    #: often means the process is absent altogether, while being above it
    #: usually means a different but still convective regime.
    margin_low: float | None = None
    #: Where the transfer sits when its feature is missing entirely. None
    #: means the engine must handle absence itself rather than substituting
    #: a neutral value -- the default, and the safer behaviour.
    absent: float | None = None

    def __post_init__(self) -> None:
        if not self.reasoning.strip():
            raise ValueError(
                f"transfer {self.name!r} has no reasoning. An undocumented "
                f"threshold is the thing this module exists to prevent."
            )
        if not self.reference.strip():
            raise ValueError(
                f"transfer {self.name!r} has no reference."
            )
        if self.shape is Shape.BAND and self.margin <= 0:
            raise ValueError(
                f"transfer {self.name!r} is a BAND and needs a positive margin"
            )
        if self.high == self.low and self.shape is not Shape.BAND:
            raise ValueError(
                f"transfer {self.name!r} has identical anchors"
            )

    def __call__(self, value: float | None) -> float | None:
        """Map a physical value to [0, 1]. None in, `absent` out."""
        if value is None:
            return self.absent
        try:
            x = float(value)
        except (TypeError, ValueError):
            return self.absent
        if not math.isfinite(x):
            return self.absent

        lo, hi = self.low, self.high
        if self.shape is Shape.RAMP:
            return _clip((x - lo) / (hi - lo))
        if self.shape is Shape.INVERSE_RAMP:
            return _clip(1.0 - (x - lo) / (hi - lo))
        if self.shape is Shape.LOGISTIC:
            # Anchors are the 10% and 90% points, so the curve is fully
            # determined by them -- no separate steepness parameter to tune.
            midpoint = 0.5 * (lo + hi)
            span = hi - lo
            if span == 0:
                return 0.5
            k = 2.0 * math.log(9.0) / span
            return _logistic(-k * (x - midpoint))
        if self.shape is Shape.INVERSE_LOGISTIC:
            midpoint = 0.5 * (lo + hi)
            span = hi - lo
            if span == 0:
                return 0.5
            k = 2.0 * math.log(9.0) / span
            return _logistic(k * (x - midpoint))
        if self.shape is Shape.BAND:
            if lo <= x <= hi:
                return 1.0
            if x < lo:
                margin = (
                    self.margin_low if self.margin_low is not None
                    else self.margin
                )
                return _clip(1.0 - (lo - x) / margin)
            return _clip(1.0 - (x - hi) / self.margin)
        raise ValueError(f"unhandled shape {self.shape}")

    def describe(self) -> dict:
        return {
            "name": self.name,
            "feature": self.feature,
            "unit": self.unit,
            "shape": self.shape.value,
            "low": self.low,
            "high": self.high,
            "margin": self.margin or None,
            "margin_low": self.margin_low,
            "reasoning": self.reasoning,
            "reference": self.reference,
            "limitations": self.limitations,
            "behaviour_when_absent": (
                "engine must handle" if self.absent is None else self.absent
            ),
        }


def _clip(value: float) -> float:
    return float(min(1.0, max(0.0, value)))


#: Beyond this the logistic is saturated to well under one part in 1e15, and
#: math.exp overflows around 710. Clamping rather than raising matters: a
#: single absurd grid cell must not take down an engine over the whole
#: domain, and the clamped answer (0 or 1) is the correct limit anyway.
_EXP_LIMIT = 500.0


def _logistic(exponent: float) -> float:
    """1 / (1 + exp(exponent)), safe against overflow."""
    if exponent > _EXP_LIMIT:
        return 0.0
    if exponent < -_EXP_LIMIT:
        return 1.0
    return _clip(1.0 / (1.0 + math.exp(exponent)))


class Rule(str, Enum):
    """How memberships combine. None has a tunable coefficient."""

    INGREDIENTS = "ingredients"     # geometric mean
    CONDITIONAL = "conditional"     # product of a probability chain
    LIMITING = "limiting"           # minimum
    ALTERNATIVES = "alternatives"   # noisy-OR
    DOMINANT = "dominant"           # maximum


#: Which rules assume the factors are INDEPENDENT. Using one of these on
#: correlated inputs is a genuine modelling error, not a stylistic one:
#: noisy-OR across four correlated measures of mid-level dryness compounds
#: them into near-certainty, because it treats each as fresh evidence when
#: they are largely the same evidence restated. Use DOMINANT for correlated
#: measures of one driver, and reserve ALTERNATIVES for mechanisms that
#: really are separate physical routes to the same outcome.
INDEPENDENCE_ASSUMING = (Rule.ALTERNATIVES, Rule.CONDITIONAL)


@dataclass(slots=True)
class Factor:
    """One evaluated feature on its way into a composition."""

    transfer: Transfer
    value: float | None
    membership: float | None = None
    note: str = ""
    #: False for a factor that is informative but must not be allowed to
    #: drive the result to zero on its own.
    required: bool = True

    def __post_init__(self) -> None:
        if self.membership is None:
            self.membership = self.transfer(self.value)


@dataclass(slots=True)
class Composition:
    """The outcome of combining factors, with influences read back out."""

    rule: Rule
    value: float
    factors: list[Factor] = dc_field(default_factory=list)
    missing: tuple[str, ...] = ()

    @property
    def contributions(self) -> tuple[Contribution, ...]:
        """Per-factor influence, DERIVED from the composition.

        For `ingredients` and `limiting`, influence is the share of the total
        shortfall below 1 that a factor accounts for -- so the feature most
        responsible for a low score ranks first, which is the question a
        forecaster actually asks. For `alternatives` it is the share of the
        support. Nothing here was used as a multiplier.
        """
        usable = [f for f in self.factors if f.membership is not None]
        if not usable:
            return ()

        if self.rule in (Rule.ALTERNATIVES, Rule.DOMINANT):
            total = sum(f.membership for f in usable)
            shares = [
                (f.membership / total) if total > 0 else 0.0 for f in usable
            ]
        else:
            shortfalls = [1.0 - f.membership for f in usable]
            total = sum(shortfalls)
            if total <= 1e-12:
                # Everything is at its maximum: influence is shared equally,
                # because nothing is holding the result back.
                shares = [1.0 / len(usable)] * len(usable)
            else:
                shares = [s / total for s in shortfalls]

        out = []
        for factor, share in zip(usable, shares):
            membership = factor.membership
            if self.rule in (Rule.ALTERNATIVES, Rule.DOMINANT):
                direction = "supporting" if membership > 0.5 else "neutral"
            elif membership < 0.4:
                direction = "limiting"
            elif membership > 0.6:
                direction = "supporting"
            else:
                direction = "neutral"
            out.append(Contribution(
                feature=factor.transfer.feature,
                value=factor.value,
                unit=factor.transfer.unit,
                transformed=round(membership, 4),
                influence=round(share, 4),
                direction=direction,
                note=factor.note,
            ))
        return tuple(out)

    @property
    def limiting(self) -> Factor | None:
        usable = [f for f in self.factors if f.membership is not None]
        if not usable:
            return None
        return min(usable, key=lambda f: f.membership)


def compose(
    rule: Rule, factors: list[Factor], *, minimum_factors: int = 1
) -> Composition | None:
    """Combine memberships. None when too few factors could be evaluated.

    Factors whose membership could not be computed are EXCLUDED and named in
    `missing` -- never silently replaced by a neutral 0.5, which would let an
    absent input quietly argue for a middling answer.
    """
    usable = [f for f in factors if f.membership is not None]
    missing = tuple(
        f.transfer.feature for f in factors if f.membership is None
    )
    if len(usable) < max(1, minimum_factors):
        return None

    memberships = [f.membership for f in usable]

    if rule is Rule.INGREDIENTS:
        # Geometric mean with equal exponents. Any zero takes the whole
        # result to zero, which is the defining property of an ingredient.
        if any(m <= 0.0 for m in memberships):
            value = 0.0
        else:
            value = float(np.exp(np.mean(np.log(memberships))))
    elif rule is Rule.CONDITIONAL:
        value = float(np.prod(memberships))
    elif rule is Rule.LIMITING:
        value = float(min(memberships))
    elif rule is Rule.ALTERNATIVES:
        value = float(1.0 - np.prod([1.0 - m for m in memberships]))
    elif rule is Rule.DOMINANT:
        # Several CORRELATED measures of one driver: the strongest governs
        # and the others add no independent evidence. Deliberately not
        # noisy-OR, which would treat restatements of the same fact as
        # separate confirmations and saturate towards 1.
        value = float(max(memberships))
    else:
        raise ValueError(f"unhandled rule {rule}")

    return Composition(
        rule=rule, value=_clip(value), factors=usable, missing=missing
    )


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

#: Identity map for a membership that has already been composed. Needed so
#: a two-stage composition (combine correlated measures, then treat the
#: result as one ingredient) stays inside the same audited machinery instead
#: of doing arithmetic by hand.
def pass_through(feature: str, note: str, reference: str) -> Transfer:
    return Transfer(
        name=f"{feature}_pass_through", feature=feature,
        unit="dimensionless", shape=Shape.RAMP, low=0.0, high=1.0,
        reasoning="Identity on an already-bounded membership. " + note,
        reference=reference,
    )


def normalise_by_transfer(value: float | None, transfer: Transfer) -> float | None:
    """The only sanctioned way to put a physical value on [0, 1].

    Deliberately NOT a generic min-max over whatever range happened to be
    present. A field's observed range on one day is not its physical scale,
    so min-max normalisation makes the same CAPE mean different things on
    different days and destroys comparability between runs entirely.
    """
    return transfer(value)


@dataclass(frozen=True, slots=True)
class ClimatologyHook:
    """Interface for later climatological normalisation.

    Percentiles and anomalies are usually more informative than absolute
    values -- 800 J/kg is unremarkable in Oklahoma and exceptional over
    Scotland. No climatology dataset exists for this platform yet, and
    Stage 5 must not fabricate one, so this records what a later stage must
    provide and reports honestly that it cannot yet.
    """

    available: bool = False
    source: str = ""
    period: str = ""

    def percentile(self, feature: str, value: float,
                   latitude: float, month: int) -> float | None:
        """Climatological percentile of `value`, or None when unavailable."""
        if not self.available:
            return None
        raise NotImplementedError(
            "a climatology source was declared available but no backend is "
            "wired in"
        )

    def to_dict(self) -> dict:
        return {
            "available": self.available,
            "source": self.source or None,
            "period": self.period or None,
            "note": (
                "no climatology is wired in; engines use physically anchored "
                "transfer functions and expose absolute values alongside "
                "every score"
            ) if not self.available else "",
        }


#: The platform's single climatology hook. Wire a real source in here.
CLIMATOLOGY = ClimatologyHook()
