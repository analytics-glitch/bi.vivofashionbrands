"""Regression test — iter 70.

Locks in the May-2026 behaviour that the warehouse-to-store IBT
recommender drops any (style, destination_store) pair that's been on
the daily replenishment list within the last 3 calendar days.

The dedup helper is READ-ONLY against `_repl_cache`; this test seeds a
synthetic entry there and asserts the helper picks it up. The full
warehouse-IBT integration is exercised separately by the e2e suite —
this file is a unit-level guard against a future agent accidentally
breaking the cache-key parsing or the (style, store) tuple shape.
"""
import asyncio
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Make the backend package importable when pytest runs from /app/backend.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_replenishment_dedup_picks_up_recent_cache_entries():
    from server import _repl_cache, _repl_dedup_cache, _replenishment_pairs_for_dedup

    async def _run():
        today = datetime.now(timezone.utc).date()
        df = (today - timedelta(days=2)).isoformat()
        dt = today.isoformat()
        cache_key = f"{df}|{dt}||"
        _repl_cache[cache_key] = (
            time.time(),
            {
                "rows": [
                    {"style_name": "REGRESSION STYLE A", "pos_location": "Vivo Sarit"},
                    {"style_name": "REGRESSION STYLE B", "pos_location": "Vivo TRM"},
                ],
            },
        )
        _repl_dedup_cache.clear()
        return await _replenishment_pairs_for_dedup(country=None)

    pairs = asyncio.run(_run())
    assert ("REGRESSION STYLE A", "Vivo Sarit") in pairs
    assert ("REGRESSION STYLE B", "Vivo TRM") in pairs


def test_replenishment_dedup_ignores_old_windows():
    """A replenishment cache entry whose window ended >2 days ago must
    NOT contribute to today's warehouse-IBT dedup — otherwise stale
    historical data would permanently mask legitimate replenishments.
    """
    from server import _repl_cache, _repl_dedup_cache, _replenishment_pairs_for_dedup

    async def _run():
        today = datetime.now(timezone.utc).date()
        # Window ended 10 days ago — well outside the 3-day window.
        df = (today - timedelta(days=12)).isoformat()
        dt = (today - timedelta(days=10)).isoformat()
        cache_key = f"{df}|{dt}||"
        _repl_cache[cache_key] = (
            time.time(),
            {"rows": [{"style_name": "ANCIENT STYLE", "pos_location": "Vivo Sarit"}]},
        )
        _repl_dedup_cache.clear()
        return await _replenishment_pairs_for_dedup(country=None)

    pairs = asyncio.run(_run())
    assert ("ANCIENT STYLE", "Vivo Sarit") not in pairs


def test_replenishment_dedup_country_scoped():
    """When the warehouse-IBT request is country-scoped, only
    replenishment entries from the same country should contribute.
    """
    from server import _repl_cache, _repl_dedup_cache, _replenishment_pairs_for_dedup

    async def _run():
        today = datetime.now(timezone.utc).date()
        df = (today - timedelta(days=2)).isoformat()
        dt = today.isoformat()
        # Replenishment cache key is "df|dt|country|owners".
        _repl_cache[f"{df}|{dt}|Kenya|"] = (
            time.time(),
            {"rows": [{"style_name": "KENYA STYLE", "pos_location": "Vivo Sarit"}]},
        )
        _repl_cache[f"{df}|{dt}|Uganda|"] = (
            time.time(),
            {"rows": [{"style_name": "UGANDA STYLE", "pos_location": "Vivo Acacia"}]},
        )
        _repl_dedup_cache.clear()
        return await _replenishment_pairs_for_dedup(country="Kenya")

    pairs = asyncio.run(_run())
    assert ("KENYA STYLE", "Vivo Sarit") in pairs
    assert ("UGANDA STYLE", "Vivo Acacia") not in pairs
