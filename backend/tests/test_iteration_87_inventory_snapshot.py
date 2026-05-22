"""Iter 87 Phase A — /inventory Mongo snapshotter regression tests.

Validates:
1. `_inventory_snapshot_id` only opts-in supported shapes (full + country-only;
   product-filtered → None so we don't blow up the keyspace).
2. `_read_inventory_snapshot` ignores stale docs and missing docs.
3. `_write_inventory_snapshot` skips unsupported (product) shapes.
4. `fetch_all_inventory()` serves from Mongo snapshot when fresh (skips
   the slow upstream fan-out).

All Mongo interactions are mocked (no real database / no real upstream)
so tests are fast, deterministic, and side-effect-free — matches the
pattern of `test_iteration_86b_orders_aggregates.py`.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import server


def _run(coro):
    return asyncio.run(coro)


# ────────────────────────────────────────────────────────────────────
# 1. snapshot id taxonomy
# ────────────────────────────────────────────────────────────────────

def test_snapshot_id_full():
    assert server._inventory_snapshot_id(None, None) == "full"


def test_snapshot_id_country_only():
    assert server._inventory_snapshot_id("Online", None) == "c=online"
    assert server._inventory_snapshot_id("Kenya", None) == "c=kenya"


def test_snapshot_id_product_filter_unsupported():
    """Product filter explodes the keyspace — refuse to snapshot."""
    assert server._inventory_snapshot_id(None, "Vivo Dress") is None
    assert server._inventory_snapshot_id("Kenya", "Vivo Dress") is None


# ────────────────────────────────────────────────────────────────────
# 2. read returns fresh, ignores stale / missing
# ────────────────────────────────────────────────────────────────────

def _patch_db_with_doc(doc):
    """Replace server.db[<coll>].find_one with a mock returning `doc`.
    Returns the patcher so the caller can `.stop()` after the test."""
    mock_coll = MagicMock()
    mock_coll.find_one = AsyncMock(return_value=doc)
    mock_db = MagicMock()
    mock_db.__getitem__.return_value = mock_coll
    return patch.object(server, "db", mock_db)


def test_read_returns_fresh_rows():
    fresh_doc = {
        "fetched_at": datetime.now(timezone.utc),
        "rows": [{"sku": "A"}, {"sku": "B"}],
    }
    with _patch_db_with_doc(fresh_doc):
        rows = _run(server._read_inventory_snapshot(None, None))
    assert rows == [{"sku": "A"}, {"sku": "B"}]


def test_read_returns_none_when_stale():
    stale = datetime.now(timezone.utc) - timedelta(
        seconds=server._INVENTORY_SNAPSHOT_TTL_SEC + 60
    )
    stale_doc = {"fetched_at": stale, "rows": [{"sku": "X"}]}
    with _patch_db_with_doc(stale_doc):
        rows = _run(server._read_inventory_snapshot(None, None))
    assert rows is None, "stale snapshot must NOT be served"


def test_read_returns_none_when_missing():
    with _patch_db_with_doc(None):
        rows = _run(server._read_inventory_snapshot(None, None))
    assert rows is None


def test_read_returns_none_for_unsupported_shape():
    # Product filter — short-circuits without even hitting Mongo.
    mock_db = MagicMock()
    with patch.object(server, "db", mock_db):
        rows = _run(server._read_inventory_snapshot(None, "Vivo Dress"))
    assert rows is None


# ────────────────────────────────────────────────────────────────────
# 3. writer skips unsupported shape
# ────────────────────────────────────────────────────────────────────

def test_write_skips_unsupported_shape():
    """Product filter must NOT attempt a Mongo write."""
    mock_db = MagicMock()  # any attribute access would explode if hit
    with patch.object(server, "db", mock_db):
        ok = _run(server._write_inventory_snapshot(None, "Vivo Dress", [{"sku": "X"}]))
    assert ok is False
    # And we never touched the collection.
    mock_db.__getitem__.assert_not_called()


def test_write_persists_supported_shape():
    mock_coll = MagicMock()
    mock_coll.replace_one = AsyncMock(return_value=None)
    mock_db = MagicMock()
    mock_db.__getitem__.return_value = mock_coll
    with patch.object(server, "db", mock_db):
        ok = _run(server._write_inventory_snapshot(None, None, [{"sku": "A"}, {"sku": "B"}]))
    assert ok is True
    mock_coll.replace_one.assert_awaited_once()
    # Sanity-check the doc shape we'd write.
    call = mock_coll.replace_one.await_args
    written = call.args[1]
    assert written["_id"] == "full"
    assert written["row_count"] == 2
    assert written["rows"] == [{"sku": "A"}, {"sku": "B"}]


# ────────────────────────────────────────────────────────────────────
# 4. fetch_all_inventory uses the snapshot when fresh
# ────────────────────────────────────────────────────────────────────

def test_fetch_all_inventory_uses_snapshot_when_fresh():
    """Critical wire-up — proves the fast-path actually short-circuits
    the slow upstream fan-out."""
    snap_rows = [{"sku": "FROM_SNAPSHOT", "available": 7}]
    # Bust the L1 cache so the only thing that could produce rows is
    # the Mongo path.
    server._inv_cache["ts"] = 0
    server._inv_cache["key"] = None
    fetch_mock = AsyncMock(side_effect=AssertionError("upstream must NOT be called"))
    with patch.object(server, "_read_inventory_snapshot", new=AsyncMock(return_value=snap_rows)), \
         patch.object(server, "fetch", new=fetch_mock):
        rows = _run(server.fetch_all_inventory())
    assert rows == snap_rows
    # L1 cache should be warmed for sibling calls.
    assert server._inv_cache["data"] == snap_rows
    fetch_mock.assert_not_awaited()
    # Cleanup
    server._inv_cache["ts"] = 0
    server._inv_cache["key"] = None
