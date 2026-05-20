"""Iter 85e — Bounded-LRU caps on previously-unbounded server.py caches.

Without these caps, the in-process caches kept growing as users browsed
new (date × country × channel × style) combos, eventually pushing pod
RSS above 1.6 GB and tripping the audit's "RSS memory critically high
— ESCALATED" email.

This test suite locks in:
  1. The pure `evict_oldest` helper has correct semantics
     (oldest-first, batch-evict, no-op below cap, handles malformed
     entries gracefully).
  2. Server-level cache constants exist and are sensibly sized.
  3. Writes to the patched caches respect the cap.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from cache_bounds import evict_oldest, total_entries  # noqa: E402


def test_evict_below_cap_is_noop():
    cache = {f"k{i}": (time.time(), i) for i in range(5)}
    popped = evict_oldest(cache, max_entries=10)
    assert popped == 0
    assert len(cache) == 5


def test_evict_oldest_drops_oldest_entries_first():
    t = time.time()
    cache = {f"k{i}": (t - (100 - i), i) for i in range(10)}
    # k0 has the OLDEST timestamp (t-100), k9 the newest (t-91).
    # Cap=8 with 10% batch => drop at least max(2, 0.8) = 2.
    evict_oldest(cache, max_entries=8)
    assert len(cache) == 8
    # The two oldest (k0, k1) must be gone; k9 must still be present.
    assert "k0" not in cache
    assert "k1" not in cache
    assert "k9" in cache


def test_evict_batch_at_least_10pct():
    """Once we're over the cap, batch-evict so we don't sort on every
    write."""
    t = time.time()
    # 200 entries, cap = 100. Expected batch = max(100, 100*0.10) = 100.
    cache = {f"k{i}": (t - (200 - i), i) for i in range(200)}
    evict_oldest(cache, max_entries=100)
    assert len(cache) == 100


def test_evict_handles_malformed_entries_gracefully():
    """If a caller mistakenly stores a non-tuple, the evictor must not
    crash — it treats those as freshest (ts=+inf) so they're evicted
    LAST, never the first to go."""
    t = time.time()
    cache = {
        "old": (t - 1000, "x"),
        "bad": "not a tuple",   # malformed — should be kept
        "new": (t, "z"),
    }
    evict_oldest(cache, max_entries=1)
    assert "bad" in cache
    assert "old" not in cache


def test_total_entries_helper():
    a = {"x": (time.time(), 1)}
    b = {"y": (time.time(), 2), "z": (time.time(), 3)}
    assert total_entries(a, b) == 3
    assert total_entries(a, None, b) == 3


# --- Server-side integration: confirm the constants are wired up.

def test_server_cache_caps_are_defined_and_sane():
    import server  # noqa: E402

    # Each cap exists and is a positive int.
    caps = {
        "_KPI_STALE_CACHE_MAX": 256,
        "_CHURN_FULL_CACHE_MAX": 8,
        "_L10_CACHE_MAX": 64,
        "_ALL_STYLES_CACHE_MAX": 32,
        "_SKU_BREAKDOWN_CACHE_MAX": 256,
        "_CURVE_CACHE_MAX": 256,
        "_STS_BY_ATTR_CACHE_MAX": 64,
        "_WEEKDAY_PATTERN_CACHE_MAX": 32,
    }
    for name, expected in caps.items():
        v = getattr(server, name, None)
        assert isinstance(v, int) and v > 0, f"{name} missing or invalid: {v}"
        assert v == expected, f"{name} expected {expected}, got {v}"


def test_l10_cache_writes_respect_cap():
    """Direct integration test — writing 200 entries into `_l10_cache`
    via the same evict call as in production stays at-or-below the cap."""
    import server  # noqa: E402

    server._l10_cache.clear()
    t = time.time()
    for i in range(200):
        server._l10_cache[f"key-{i}"] = (t + i, [{"row": i}])
        evict_oldest(server._l10_cache, max_entries=server._L10_CACHE_MAX)
    assert len(server._l10_cache) <= server._L10_CACHE_MAX, (
        f"l10 cache grew to {len(server._l10_cache)} — cap is "
        f"{server._L10_CACHE_MAX}"
    )
    server._l10_cache.clear()


def test_curve_cache_writes_respect_cap():
    import server  # noqa: E402

    server._curve_cache.clear()
    t = time.time()
    for i in range(1000):
        server._curve_cache[f"style-{i}"] = (t + i, {"rows": [i]})
        evict_oldest(server._curve_cache, max_entries=server._CURVE_CACHE_MAX)
    assert len(server._curve_cache) <= server._CURVE_CACHE_MAX
    server._curve_cache.clear()
