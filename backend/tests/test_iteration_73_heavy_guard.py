"""Iter 73 — HeavyGuard + cache-stats observability tests.

Locks in the per-endpoint concurrency caps that prevent a single heavy
click from OOM-killing the production pod (May 13 outage root cause).

Covers:
  • Guard admits up to N concurrent enters
  • Guard returns 503 when over the limit
  • No-op for unknown paths
  • Cache-stats module state wiring
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_heavy_guard_admits_under_limit():
    """Up to N concurrent enters are admitted instantly."""
    from server import HeavyGuard, _HEAVY_LIMITS, _HEAVY_SEMAPHORES

    async def _run():
        path = "/sor"
        limit = _HEAVY_LIMITS[path]
        # Force fresh semaphore so test is independent.
        _HEAVY_SEMAPHORES.pop(path, None)
        entered = 0

        async def enter_and_hold():
            nonlocal entered
            async with HeavyGuard(path):
                entered += 1
                await asyncio.sleep(0.05)

        await asyncio.gather(*[enter_and_hold() for _ in range(limit)])
        return entered, limit

    entered, limit = asyncio.run(_run())
    assert entered == limit


def test_heavy_guard_rejects_over_limit():
    """The (limit+1)-th concurrent request gets a 503 after the
    acquire timeout, instead of being allowed to pile on top of the
    pod's memory pressure."""
    from fastapi import HTTPException
    from server import HeavyGuard, _HEAVY_LIMITS, _HEAVY_SEMAPHORES, _HEAVY_GUARD_REJECTIONS
    import server as _srv

    async def _run():
        path = "/sor"
        limit = _HEAVY_LIMITS[path]
        _HEAVY_SEMAPHORES.pop(path, None)
        _HEAVY_GUARD_REJECTIONS.clear()
        original_timeout = _srv._HEAVY_ACQUIRE_TIMEOUT_SEC
        _srv._HEAVY_ACQUIRE_TIMEOUT_SEC = 0.05

        rejected = 0

        async def hold_a_slot():
            async with HeavyGuard(path):
                await asyncio.sleep(0.2)

        async def try_one_more():
            nonlocal rejected
            try:
                async with HeavyGuard(path):
                    await asyncio.sleep(0.05)
            except HTTPException as e:
                if e.status_code == 503:
                    rejected += 1

        try:
            holders = [asyncio.create_task(hold_a_slot()) for _ in range(limit)]
            await asyncio.sleep(0.02)
            await try_one_more()
            await asyncio.gather(*holders)
        finally:
            _srv._HEAVY_ACQUIRE_TIMEOUT_SEC = original_timeout

        return rejected, _HEAVY_GUARD_REJECTIONS.get(path, 0)

    rejected, total = asyncio.run(_run())
    assert rejected == 1, f"expected exactly 1 rejection, got {rejected}"
    assert total >= 1


def test_heavy_guard_unknown_path_is_noop():
    """A path with no configured limit is a no-op — many concurrent
    enters should all succeed instantly."""
    from server import HeavyGuard

    async def _run():
        entered = 0

        async def enter_unknown():
            nonlocal entered
            async with HeavyGuard("/some/unknown/route"):
                entered += 1

        await asyncio.gather(*[enter_unknown() for _ in range(20)])
        return entered

    assert asyncio.run(_run()) == 20


def test_cache_stats_constants_exist():
    """Smoke test that the cache-stats endpoint's required module-level
    state is wired up."""
    from server import (
        _FETCH_CACHE, _CACHE_HITS_L1, _CACHE_HITS_L2, _CACHE_MISSES,
        _CACHE_INFLIGHT_JOIN, _HEAVY_LIMITS, _HEAVY_GUARD_REJECTIONS,
        _PROCESS_STARTED_AT,
    )
    assert isinstance(_FETCH_CACHE, dict)
    assert isinstance(_CACHE_HITS_L1, int)
    assert isinstance(_CACHE_HITS_L2, int)
    assert isinstance(_CACHE_MISSES, int)
    assert isinstance(_CACHE_INFLIGHT_JOIN, int)
    assert isinstance(_HEAVY_LIMITS, dict) and len(_HEAVY_LIMITS) > 0
    assert isinstance(_HEAVY_GUARD_REJECTIONS, dict)
    assert _PROCESS_STARTED_AT > 0
