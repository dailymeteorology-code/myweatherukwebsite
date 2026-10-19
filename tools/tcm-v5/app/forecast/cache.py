"""Caches for forecast products.

Everything TCM derives is a pure function of the stored model run: for a
given cycle, the risk at T+18 and the PNG that draws it never change. So they
are computed once and kept.

The cache key always includes the RUN, so a new cycle invalidates everything
that depended on the old one automatically. That matters more than the speed:
a cache keyed only on lead time would happily serve yesterday's risk under
today's label.

Measured before this existed: each render recomputed `convective_risk` from
disk, so dragging the time slider fired dozens of concurrent recomputations
and took about thirty seconds to settle -- during which the map still showed
the previous hour's image under the new hour's label.
"""
from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from datetime import datetime
from typing import Any, Callable

log = logging.getLogger(__name__)

#: Entries per cache. A cycle holds ~55 lead times x a handful of products.
MAX_ENTRIES = 512


class RunCache:
    """A small LRU cache whose keys are scoped to a model run."""

    def __init__(self, name: str, max_entries: int = MAX_ENTRIES) -> None:
        self.name = name
        self.max_entries = max_entries
        self._entries: OrderedDict[tuple, Any] = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def _key(self, run: datetime | None, *parts) -> tuple:
        return (run.isoformat() if run else None, *parts)

    def get_or_compute(
        self, run: datetime | None, parts: tuple, compute: Callable[[], Any]
    ) -> Any:
        key = self._key(run, *parts)
        with self._lock:
            if key in self._entries:
                self._entries.move_to_end(key)
                self.hits += 1
                return self._entries[key]
            self.misses += 1

        # Computed outside the lock: these are seconds-long numpy operations
        # and holding the lock would serialise every caller behind the first.
        value = compute()

        with self._lock:
            self._entries[key] = value
            self._entries.move_to_end(key)
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)
        return value

    def invalidate_run(self, run: datetime) -> int:
        """Drop everything computed from one run."""
        stamp = run.isoformat()
        with self._lock:
            stale = [k for k in self._entries if k[0] == stamp]
            for key in stale:
                del self._entries[key]
        return len(stale)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def stats(self) -> dict:
        with self._lock:
            total = self.hits + self.misses
            return {
                "name": self.name,
                "entries": len(self._entries),
                "hits": self.hits,
                "misses": self.misses,
                "hit_rate": round(self.hits / total, 3) if total else None,
            }


RISK = RunCache("risk")
RENDER = RunCache("render", max_entries=256)
LIGHTNING = RunCache("lightning")

ALL: tuple[RunCache, ...] = (RISK, RENDER, LIGHTNING)


def clear_all() -> None:
    for cache in ALL:
        cache.clear()


def stats() -> list[dict]:
    return [cache.stats() for cache in ALL]
