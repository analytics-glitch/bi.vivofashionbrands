"""Iter 85e — Bounded-LRU helper for the in-process caches in server.py.

Goal: prevent the unbounded growth that drives RSS over 1.6 GB and
triggers the audit's "RSS memory critically high — ESCALATED" email.

We keep the caches as plain dicts (no new runtime dependency) but
require every write to call `evict_oldest(cache, max_entries=...)`
right after `cache[key] = (ts, payload, ...)`. The helper removes the
oldest 10% of entries (by timestamp) once the cap is breached — same
shape as the existing `_FETCH_CACHE` and `_CUSTOMER_HIST_CACHE`
eviction so the audit code paths stay uniform.

Caps were chosen by inspecting cardinality of the cache keys:

  - `_l10_cache`              : 64  (date_from|date_to|cluster window)
  - `_all_styles_cache`       : 32  (full-period combos)
  - `_sku_breakdown_cache`    : 256 (one entry per style_name drilldown)
  - `_curve_cache`            : 256 (one entry per style_name × period)
  - `_sts_by_attr_cache`      : 64  (date/attr combos)
  - `_weekday_pattern_cache`  : 32  (date_from|date_to|country|channel)
  - `_kpi_stale_cache`        : 256 (entry per call signature; high cardinality)
  - `_churn_full_cache`       : 8   (only keyed on churn_window_days)

Each entry is the same shape we used pre-fix: `(ts, payload, ...)`.
The helper inspects `entry[0]` as the epoch timestamp.

NOTE: This module is deliberately stateless and dependency-free so it
can be re-used (or migrated to `cachetools.TTLCache` later) without
rewriting callers.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple


def evict_oldest(
    cache: Dict[Any, Tuple],
    *,
    max_entries: int,
    evict_batch_pct: float = 0.10,
) -> int:
    """Evict the oldest 10 % of entries from `cache` once `len(cache) >
    max_entries`. Returns the number of entries actually popped.

    The cache values MUST be tuples whose first element is an epoch
    timestamp (this matches every cache in `server.py`). If `cache` is
    empty or under the cap, this is a no-op.

    Why batch-evict 10 % instead of one entry at a time:
      * Avoids the O(N log N) sort cost of running the evictor on every
        single write once we sit right at the cap.
      * Mirrors the `_FETCH_CACHE` eviction policy already shipped in
        production, so behaviour is consistent across cache layers.
    """
    n = len(cache)
    if n <= max_entries:
        return 0
    # How many to drop: enough to bring us back below the cap, but at
    # least batch_pct of max_entries so we don't sort on every write.
    over = n - max_entries
    batch = max(over, int(max_entries * evict_batch_pct))
    batch = min(batch, n)
    # Sort by timestamp (entry[0]) and drop the oldest `batch`.
    oldest_keys = sorted(
        cache.keys(),
        key=lambda k: _entry_ts(cache[k]),
    )[:batch]
    for k in oldest_keys:
        cache.pop(k, None)
    return len(oldest_keys)


def _entry_ts(entry: Any) -> float:
    """Best-effort epoch extractor.

    Tuples are the norm (`(ts, payload, ...)`). Anything else is
    treated as freshly-written (ts = +inf) so it is evicted last —
    that's the safest fallback if a caller starts storing a non-tuple
    by mistake.
    """
    if isinstance(entry, tuple) and entry and isinstance(entry[0], (int, float)):
        return float(entry[0])
    return float("inf")


def total_entries(*caches: Dict[Any, Any]) -> int:
    """Sum the entry count across the given caches — handy for the
    `/admin/cache-stats` endpoint."""
    return sum(len(c) for c in caches if c is not None)
