"""Iter 84i — Persistent style launch-date cache.

Background: `/analytics/sor-all-styles` previously returned
`launch_date: null` for every style whose first sale was older than
180 days (the cost-fence on the /orders fan-out helper). For the
SOR export this meant "most styles missing launch date" — because
the catalog is dominated by styles that have been trading for >6
months.

The fix introduces a Mongo collection `style_launch_dates` that
incrementally retains MIN(first_sale_iso) per style across every
run. New styles are written on first observation; old styles are
backfilled on every subsequent run.

These tests cover:
  • The persistent helper correctly upserts the minimum.
  • Subsequent observations of an EARLIER first-sale shift the value
    earlier (never later — that would discard real history).
  • The hydrate helper returns one-doc-per-requested-style.

We use a single event-loop per test (via the @asyncio_run decorator
style) instead of asyncio.run inside fixtures — Motor caches its loop
and the second asyncio.run() call breaks otherwise.
"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


async def _drop_test_docs():
    import server
    await server.db.style_launch_dates.delete_many(
        {"style_name": {"$regex": "^_iter84i_test_"}}
    )


def _run(coro):
    """Drop test docs, run the coroutine, drop again — all on one event
    loop. Works around Motor's loop-caching behaviour by re-initialising
    the motor client inside this loop (Motor binds its client to whichever
    event loop is current at first await, so re-importing the module after
    a previous test's loop has closed leaves a stale binding)."""
    async def _wrapped():
        # Iter 84i — rebind Motor client to THIS loop so it isn't bound
        # to a stale loop closed by a prior test. Tests use a fresh
        # asyncio.run() each, but the module-level `db` outlives them.
        import server
        from motor.motor_asyncio import AsyncIOMotorClient
        import os as _os
        server.client = AsyncIOMotorClient(_os.environ["MONGO_URL"])
        server.db = server.client[_os.environ["DB_NAME"]]
        await _drop_test_docs()
        try:
            return await coro()
        finally:
            await _drop_test_docs()
    return asyncio.run(_wrapped())


def test_persist_writes_minimum():
    """First write inserts the doc; second write with an EARLIER date
    shifts the value earlier; second write with a LATER date is a no-op."""
    async def _scenario():
        import server
        # Initial observation: 2025-03-15
        await server._persist_style_launch_dates({
            "_iter84i_test_alpha": ("2025-03-15", "2025-09-01"),
        })
        doc = await server.db.style_launch_dates.find_one(
            {"style_name": "_iter84i_test_alpha"}, {"_id": 0}
        )
        assert doc is not None
        assert doc["first_sale_iso"] == "2025-03-15"

        # Earlier observation should shift the value earlier.
        await server._persist_style_launch_dates({
            "_iter84i_test_alpha": ("2024-12-01", "2025-09-01"),
        })
        doc = await server.db.style_launch_dates.find_one(
            {"style_name": "_iter84i_test_alpha"}, {"_id": 0}
        )
        assert doc["first_sale_iso"] == "2024-12-01"

        # Later observation must NOT overwrite — $min semantics.
        await server._persist_style_launch_dates({
            "_iter84i_test_alpha": ("2025-06-01", "2025-09-01"),
        })
        doc = await server.db.style_launch_dates.find_one(
            {"style_name": "_iter84i_test_alpha"}, {"_id": 0}
        )
        assert doc["first_sale_iso"] == "2024-12-01"
    _run(_scenario)


def test_persist_handles_empty_input():
    """Empty / None input must be a graceful no-op — never raise."""
    async def _scenario():
        import server
        await server._persist_style_launch_dates({})
        await server._persist_style_launch_dates(None)  # type: ignore[arg-type]
        count = await server.db.style_launch_dates.count_documents(
            {"style_name": {"$regex": "^_iter84i_test_"}}
        )
        assert count == 0
    _run(_scenario)


def test_persist_skips_styles_with_blank_first_iso():
    """A style with a blank first_sale_iso shouldn't be inserted —
    that would create a useless null row that the hydrate helper
    would then return."""
    async def _scenario():
        import server
        await server._persist_style_launch_dates({
            "_iter84i_test_blank": ("", "2025-09-01"),
            "_iter84i_test_good": ("2025-03-01", "2025-09-01"),
        })
        doc_blank = await server.db.style_launch_dates.find_one(
            {"style_name": "_iter84i_test_blank"}
        )
        doc_good = await server.db.style_launch_dates.find_one(
            {"style_name": "_iter84i_test_good"}
        )
        assert doc_blank is None
        assert doc_good is not None
        assert doc_good["first_sale_iso"] == "2025-03-01"
    _run(_scenario)


def test_hydrate_returns_requested_styles_only():
    """The hydrate helper must filter to the requested style list —
    we don't want to read the entire collection into memory."""
    async def _scenario():
        import server
        await server._persist_style_launch_dates({
            "_iter84i_test_a": ("2024-01-01", "2025-01-01"),
            "_iter84i_test_b": ("2024-06-01", "2025-06-01"),
            "_iter84i_test_c": ("2024-09-01", "2025-09-01"),
        })
        result = await server._hydrate_launch_dates_from_mongo([
            "_iter84i_test_a", "_iter84i_test_c", "_iter84i_test_NEVER_SEEN"
        ])
        assert "_iter84i_test_a" in result
        assert result["_iter84i_test_a"] == "2024-01-01"
        assert "_iter84i_test_c" in result
        assert result["_iter84i_test_c"] == "2024-09-01"
        # b was NOT requested — must not appear.
        assert "_iter84i_test_b" not in result
        # Never-seen style — silent absence, no exception.
        assert "_iter84i_test_NEVER_SEEN" not in result
    _run(_scenario)


def test_hydrate_returns_empty_dict_on_empty_input():
    """Defensive: callers may pass an empty list."""
    async def _scenario():
        import server
        result = await server._hydrate_launch_dates_from_mongo([])
        assert result == {}
    _run(_scenario)
