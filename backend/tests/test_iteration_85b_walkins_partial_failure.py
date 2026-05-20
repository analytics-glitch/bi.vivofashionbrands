"""Iter 85b — Walk-ins partial-failure isolation.

The bug: when one of the underlying `/orders` chunks fetched by
`_orders_for_window` failed (upstream 5xx / timeout), the partial result
was still written to `_CUSTOMER_HIST_CACHE` for 10 minutes. Every
subsequent caller in that window saw the truncated dataset — which
manifested in the UI as walk-in counts collapsing from 82 → 1 between
two consecutive page loads of the Customers page.

The fix:
  • `_orders_for_window` no longer caches a result when any chunk failed.
  • A sidecar dict `_orders_window_last_status` records the per-key
    `{failed_chunks, degraded, ...}` so callers like /customers/walk-ins
    can flag `degraded: true` on their own response.
  • `_get_walk_ins_impl` now routes through `_orders_for_window` so it
    inherits the existing split-on-failure recursion and 50k-cap
    auto-pagination (Iter 84g).

These tests pin the contract.
"""
from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server  # noqa: E402
from fastapi import HTTPException  # noqa: E402


def _clear_caches():
    server._CUSTOMER_HIST_CACHE.clear()
    server._orders_window_last_status.clear()


def test_partial_failure_result_is_NOT_cached():
    """A 14-day window with 2 chunks where one chunk fails must return
    the partial result to the caller, but the next call rebuilds from
    upstream (no cache entry written).

    This is the canonical regression for the walk-ins 82 → 1 bug.
    """
    async def _scenario():
        _clear_caches()
        # Two chunks: first succeeds with 3 rows, second fails with 5xx
        # that bisects below the depth limit. We force the failure to
        # propagate (depth >= 4) so the chunk is recorded as failed.
        ok_payload = [{"order_id": f"ok-{i}", "order_date": "2026-05-10"} for i in range(3)]

        call_count = {"n": 0}
        async def fake_safe_fetch(path, params):
            call_count["n"] += 1
            df = (params or {}).get("date_from", "")
            # First chunk (older window) succeeds
            if df.startswith("2026-05-01") or df.startswith("2026-05-02") or df.startswith("2026-05-03") or df.startswith("2026-05-04") or df.startswith("2026-05-05") or df.startswith("2026-05-06") or df.startswith("2026-05-07") or df.startswith("2026-05-08") or df.startswith("2026-05-09") or df.startswith("2026-05-10") or df.startswith("2026-05-11") or df.startswith("2026-05-12") or df.startswith("2026-05-13") or df.startswith("2026-05-14"):
                return ok_payload
            # Second chunk always raises — split-on-failure will recurse
            # but every sub-window will also raise → eventually returns
            # `failed_chunks += 1` for that chunk.
            raise HTTPException(status_code=503, detail="upstream down")

        with patch.object(server, "_safe_fetch", new=AsyncMock(side_effect=fake_safe_fetch)):
            # 28-day window → 2 chunks of 14 days each
            res1 = await server._orders_for_window(
                "2026-05-01", "2026-05-28", country=None, channel=None,
            )

        # Partial result is served to THIS caller.
        # (We don't assert exact length because split-on-failure may
        # bisect and discover the same `ok_payload` recursively — what
        # matters is that the cache was NOT written.)
        assert isinstance(res1, list)

        # The sidecar must report `degraded=True`.
        key = "2026-05-01|2026-05-28||"
        status = server._orders_window_last_status.get(key)
        assert status is not None, "sidecar status must be populated"
        assert status["degraded"] is True, f"expected degraded=True, got {status}"
        assert status["failed_chunks"] >= 1

        # And the result MUST NOT be in the persistent cache — so the
        # next call rebuilds (the walk-ins regression fix).
        assert key not in server._CUSTOMER_HIST_CACHE, (
            "partial-failure result was cached — this is the exact bug "
            "we're fixing. _CUSTOMER_HIST_CACHE keys: "
            f"{list(server._CUSTOMER_HIST_CACHE.keys())}"
        )

    asyncio.run(_scenario())


def test_fully_clean_result_IS_cached():
    """Sanity check: when every chunk succeeds, the result is cached for
    the next caller (the 10-min hot-path optimisation must still work)."""
    async def _scenario():
        _clear_caches()
        async def fake_safe_fetch(path, params):
            return [{"order_id": "ok", "order_date": "2026-05-10"}]

        with patch.object(server, "_safe_fetch", new=AsyncMock(side_effect=fake_safe_fetch)):
            await server._orders_for_window(
                "2026-05-01", "2026-05-14", country=None, channel=None,
            )

        key = "2026-05-01|2026-05-14||"
        assert key in server._CUSTOMER_HIST_CACHE, (
            "clean result must be cached for the next caller"
        )
        status = server._orders_window_last_status.get(key)
        assert status is not None
        assert status["degraded"] is False

    asyncio.run(_scenario())


def test_cache_hit_marks_status_as_clean():
    """A cache HIT must not leave a stale degraded=True status from a
    prior failed call — otherwise the walk-ins endpoint would
    permanently flag itself as degraded once a single transient failure
    poisoned the sidecar."""
    async def _scenario():
        _clear_caches()
        # Seed the cache with a clean result (simulating the prior
        # successful call).
        key = "2026-05-01|2026-05-14||"
        server._CUSTOMER_HIST_CACHE[key] = (time.time(), [{"order_id": "ok"}])
        # Manually poison the sidecar to simulate a previous degraded
        # call that wrote bad status but never made it to cache.
        server._orders_window_last_status[key] = {
            "failed_chunks": 1, "total_chunks": 2,
            "degraded": True, "checked_at": time.time(),
        }
        # Call again — should hit the cache and OVERWRITE status as clean.
        with patch.object(server, "_safe_fetch", new=AsyncMock(return_value=[])):
            result = await server._orders_for_window(
                "2026-05-01", "2026-05-14", country=None, channel=None,
            )

        assert result == [{"order_id": "ok"}]
        status = server._orders_window_last_status[key]
        assert status["degraded"] is False, (
            "cache hits must mark status as clean, not inherit stale degraded flag"
        )
        assert status.get("from_cache") is True

    asyncio.run(_scenario())


def test_walk_ins_response_includes_degraded_flag():
    """End-to-end: when /orders is flaky, /customers/walk-ins must
    surface `degraded: true` so the FE can show a banner."""
    async def _scenario():
        _clear_caches()
        # First call to _orders_for_window returns degraded status.
        async def fake_owf(date_from, date_to, country=None, channel=None):
            key = f"{date_from}|{date_to}|{country or ''}|{channel or ''}"
            server._orders_window_last_status[key] = {
                "failed_chunks": 1, "total_chunks": 2,
                "degraded": True, "checked_at": time.time(),
            }
            return [{"order_id": "x", "customer_id": None, "quantity": 1,
                     "total_sales_kes": 100.0, "country": "Kenya"}]

        async def fake_get_kpis(**kw):
            return {"total_sales": 1000.0}

        async def fake_name_lookup():
            return {}

        with patch.object(server, "_orders_for_window", new=AsyncMock(side_effect=fake_owf)), \
             patch.object(server, "get_kpis", new=AsyncMock(side_effect=fake_get_kpis)), \
             patch.object(server, "_get_customer_name_lookup", new=AsyncMock(side_effect=fake_name_lookup)):
            result = await server._get_walk_ins_impl(
                date_from="2026-05-17", date_to="2026-05-17",
            )

        assert result["degraded"] is True, (
            f"walk-ins response must surface degraded=True, got {result}"
        )

    asyncio.run(_scenario())
