"""Ensemble scenario clusters.

Percentiles and clusters answer different questions, and the difference is
the reason both exist.

A percentile is computed independently at every grid cell, so the P90 map is
not a forecast any member produced -- its wet corner and its dry corner may
come from different members entirely. `ensemble.py` says so and refuses to
call it a scenario.

A cluster is a group of WHOLE members. Every field in a cluster came from one
model integration, so a cluster representative IS a physically coherent
scenario: the rain in the north and the rain in the south belong to the same
forecast. That is what makes "the wet scenario" a legitimate thing to show,
where "the P90 map" is not.

The honest limit: clustering three members is not analysis, it is labelling.
`meaningful` is False below `MIN_MEMBERS_FOR_CLUSTERS`, and the caller is
expected to present the members individually rather than dressing them up as
scenarios.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field

import numpy as np

from ..grid import Field

log = logging.getLogger(__name__)

#: Below this, clusters carry no more information than the members do.
MIN_MEMBERS_FOR_CLUSTERS = 6

#: Never produce more clusters than this, however many members exist.
MAX_CLUSTERS = 4


@dataclass(slots=True)
class Cluster:
    """One coherent scenario: a group of whole ensemble members."""

    index: int
    members: tuple[int, ...]
    #: The member closest to the cluster's own mean -- a real member, not a
    #: synthetic average, so it stays physically coherent.
    representative_member: int
    #: Mean of the cluster's members, for a summary map only.
    mean: np.ndarray = dc_field(repr=False)
    #: How far this cluster sits from the full-ensemble mean.
    distance_from_ensemble: float = 0.0
    peak: float = 0.0
    label: str = ""

    @property
    def size(self) -> int:
        return len(self.members)

    def to_dict(self, total_members: int) -> dict:
        return {
            "index": self.index,
            "label": self.label,
            "members": list(self.members),
            "size": self.size,
            "share_percent": round(100 * self.size / max(total_members, 1), 1),
            "representative_member": self.representative_member,
            "peak": round(self.peak, 3),
            "distance_from_ensemble_mean": round(
                self.distance_from_ensemble, 3
            ),
            "spatially_coherent": True,
        }


@dataclass(slots=True)
class ClusterSet:
    parameter: str
    forecast_hour: int
    n_members: int
    clusters: list[Cluster]
    meaningful: bool
    reason: str = ""

    def to_dict(self) -> dict:
        return {
            "parameter": self.parameter,
            "forecast_hour": self.forecast_hour,
            "n_members": self.n_members,
            "cluster_count": len(self.clusters),
            "meaningful": self.meaningful,
            "reason": self.reason,
            "min_members_for_clusters": MIN_MEMBERS_FOR_CLUSTERS,
            "clusters": [c.to_dict(self.n_members) for c in self.clusters],
            "note": (
                "A cluster is a group of whole ensemble members, so its "
                "representative is a physically coherent scenario. This is "
                "the opposite of a percentile map, which is computed per "
                "grid cell and is not a scenario any member produced."
            ),
        }


def _distance_matrix(stack: np.ndarray) -> np.ndarray:
    """Root-mean-square difference between every pair of members."""
    n = stack.shape[0]
    flat = stack.reshape(n, -1)
    finite = np.isfinite(flat).all(axis=0)
    flat = flat[:, finite]
    distance = np.zeros((n, n), dtype="float64")
    for i in range(n):
        for j in range(i + 1, n):
            value = float(np.sqrt(np.mean((flat[i] - flat[j]) ** 2)))
            distance[i, j] = distance[j, i] = value
    return distance


def _assign(distance: np.ndarray, k: int) -> list[list[int]]:
    """Agglomerative grouping on the pairwise distances.

    Deliberately simple and deterministic: start with every member in its own
    group and repeatedly merge the two closest groups (complete linkage) until
    `k` remain. With ensembles this small there is nothing to gain from
    anything more elaborate, and determinism matters more -- the same cycle
    must always cluster the same way.
    """
    groups = [[i] for i in range(distance.shape[0])]
    while len(groups) > k:
        best = None
        for a in range(len(groups)):
            for b in range(a + 1, len(groups)):
                linkage = max(
                    distance[i, j] for i in groups[a] for j in groups[b]
                )
                if best is None or linkage < best[0]:
                    best = (linkage, a, b)
        _, a, b = best
        groups[a].extend(groups[b])
        groups.pop(b)
    return [sorted(g) for g in groups]


def cluster(fields: list[Field], max_clusters: int = MAX_CLUSTERS) -> ClusterSet:
    """Group ensemble members into coherent scenarios."""
    if not fields:
        raise ValueError("no members to cluster")

    parameter = fields[0].meta.parameter
    forecast_hour = fields[0].meta.forecast_hour
    members = [
        f.meta.member if f.meta.member is not None else i
        for i, f in enumerate(fields)
    ]
    n = len(fields)

    if n < MIN_MEMBERS_FOR_CLUSTERS:
        return ClusterSet(
            parameter=parameter, forecast_hour=forecast_hour, n_members=n,
            clusters=[], meaningful=False,
            reason=(
                f"{n} members: clustering needs at least "
                f"{MIN_MEMBERS_FOR_CLUSTERS} to say anything the individual "
                "members do not. Show the members themselves instead."
            ),
        )

    stack = np.stack([f.values for f in fields]).astype("float32")
    k = max(1, min(max_clusters, n // 2))
    groups = _assign(_distance_matrix(stack), k)

    with np.errstate(invalid="ignore"):
        ensemble_mean = np.nanmean(stack, axis=0)

    clusters: list[Cluster] = []
    for index, group in enumerate(sorted(groups, key=len, reverse=True)):
        with np.errstate(invalid="ignore"):
            group_mean = np.nanmean(stack[group], axis=0)
            # The representative is a REAL member, never the mean: averaging
            # members smooths away the coherent structure that makes a
            # scenario worth showing.
            closest = min(
                group,
                key=lambda i: float(
                    np.nanmean((stack[i] - group_mean) ** 2)
                ),
            )
            distance = float(
                np.sqrt(np.nanmean((group_mean - ensemble_mean) ** 2))
            )
            peak = float(np.nanmax(group_mean))

        clusters.append(Cluster(
            index=index,
            members=tuple(members[i] for i in group),
            representative_member=members[closest],
            mean=group_mean,
            distance_from_ensemble=distance,
            peak=peak,
        ))

    _label(clusters)
    return ClusterSet(
        parameter=parameter, forecast_hour=forecast_hour, n_members=n,
        clusters=clusters, meaningful=True,
        reason=f"{n} members grouped into {len(clusters)} scenarios",
    )


def _label(clusters: list[Cluster]) -> None:
    """Name clusters by where they sit on the intensity range."""
    if not clusters:
        return
    order = sorted(clusters, key=lambda c: c.peak)
    if len(order) == 1:
        order[0].label = "single scenario"
        return
    order[0].label = "lower-end scenario"
    order[-1].label = "upper-end scenario"
    for c in order[1:-1]:
        c.label = "middle scenario"
