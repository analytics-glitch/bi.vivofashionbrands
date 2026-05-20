"""Iter 84g — `_orders_for_window` 50k-cap pagination regression test.

Background: upstream /orders returns at most 50,000 rows per call. Before
this fix, `_orders_for_window` fired one /orders call per 30-day chunk
with `limit=50000` — busy months silently lost rows. Symptom: the SOR
new-style L-10 table showed 200 units on a parent style, but expanding
the variants showed only 20 units total because the SKU-level rebuild
used `_orders_for_window` which had truncated. Same root cause affected
`/analytics/avg-spend-by-customer-type` and `/analytics/recently-
unchurned`, both of which sum over per-customer rows.

The fix: when a chunk returns exactly the cap, slide the `date_from`
forward to the latest order_date seen, refetch, and continue until the
chunk drains. Boundary days are deduped at the end so the same
(order_id, sku, color, size) tuple cannot appear twice.

These tests are pure — they mock `_safe_fetch` and assert that the
pagination loop fires the right calls and dedups boundary duplicates.
No upstream is touched.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _row(order_id, date, sku="SKU-A", color="Red", size="M", qty=1, sales=1000):
    return {
        "order_id": order_id, "order_date": date,
        "sku": sku, "color_print": color, "size": size,
        "quantity": qty, "total_sales_kes": sales,
        "net_sales_kes": sales,
        "style_name": "Style X", "customer_id": f"c{order_id}",
    }


async def _run(date_from, date_to, side_effect):
    """Helper — clear cache, patch _safe_fetch, run, return rows."""
    import server
    server._CUSTOMER_HIST_CACHE.clear()
    with patch.object(server, "_safe_fetch", new=AsyncMock(side_effect=side_effect)) as m:
        rows = await server._orders_for_window(date_from, date_to)
        return rows, m


def test_single_call_when_under_cap():
    """A small chunk that returns < 50,000 rows should fire ONE upstream
    call per 14-day chunk — no pagination loop."""
    side = [
        [_row(i, "2026-05-05") for i in range(100)],  # 100 rows = under cap
    ]
    # Use a 7-day window so it fits in exactly ONE 14-day chunk.
    rows, mock = asyncio.run(_run("2026-05-01", "2026-05-07", side))
    assert len(rows) == 100
    assert mock.await_count == 1


def test_paginates_when_chunk_hits_cap():
    """A chunk that returns EXACTLY 50,000 rows must trigger a follow-up
    call starting at the latest order_date seen."""
    page1 = [_row(i, "2026-05-05") for i in range(50000)]
    page2 = [_row(50000 + i, "2026-05-06") for i in range(200)]
    # Use a 7-day window so it fits in exactly ONE 14-day chunk.
    rows, mock = asyncio.run(_run("2026-05-01", "2026-05-07", [page1, page2]))
    # All rows preserved (no dedup needed — order_ids are distinct).
    assert len(rows) == 50200, f"expected 50200 got {len(rows)}"
    assert mock.await_count == 2
    # Verify second call started at the latest date from page 1.
    second_call_params = mock.await_args_list[1].args[1]
    assert second_call_params["date_from"] == "2026-05-05", second_call_params


def test_dedupes_boundary_duplicates():
    """When the pagination boundary refetches the same day, identical
    rows (order_id + sku + color + size) must be deduped — counts must
    not double."""
    # Page 1: 50,000 rows, last row on 2026-05-05.
    page1 = [_row(i, "2026-05-04") for i in range(49998)]
    page1.append(_row(99001, "2026-05-05"))
    page1.append(_row(99002, "2026-05-05"))
    # Page 2: refetched from 2026-05-05 — same two boundary rows + 1 new.
    page2 = [
        _row(99001, "2026-05-05"),  # duplicate
        _row(99002, "2026-05-05"),  # duplicate
        _row(99003, "2026-05-06"),  # new
    ]
    # Use a 7-day window so it fits in ONE 14-day chunk.
    rows, _ = asyncio.run(_run("2026-05-01", "2026-05-07", [page1, page2]))
    # Expected: 50000 (page 1) + 1 new from page 2 = 50001 after dedup.
    assert len(rows) == 50001, f"expected 50001 got {len(rows)}"
    order_ids = [r["order_id"] for r in rows]
    # No duplicates of the boundary order_ids.
    assert order_ids.count(99001) == 1
    assert order_ids.count(99002) == 1


def test_stops_when_max_iters_exhausted():
    """Pathological case — every call returns exactly the cap and the
    latest date never advances. Must NOT loop forever."""
    same_day_full = [_row(i, "2026-05-01") for i in range(50000)]
    # Use a 7-day window so it fits in ONE 14-day chunk.
    rows, mock = asyncio.run(_run("2026-05-01", "2026-05-07", [same_day_full] * 50))
    # Pagination tries 32 times then breaks → total await count ≤ 32.
    assert mock.await_count <= 32, f"infinite loop suspected: {mock.await_count} calls"


def test_partial_failure_returns_partial():
    """When one chunk fails but others succeed, return the partial set
    rather than raising — analytics should still show *something*.

    Iter 84g — split-on-failure: a failing 14-day chunk is bisected
    into 7-day halves and retried. So a single HTTPException on the
    second chunk should result in:
      - chunk 1 (Apr 1-14): success, returns rows
      - chunk 2 (Apr 15-28): the call fails → bisect into Apr 15-21
        and Apr 22-28 → both bisected halves fail → counted as 1
        failed chunk."""
    import server
    page1 = [_row(i, "2026-04-05") for i in range(100)]
    from fastapi import HTTPException
    # 1st call: chunk Apr 1-14 succeeds.
    # 2nd call: chunk Apr 15-28 fails → bisect.
    # 3rd call: Apr 15-21 fails.
    # 4th call: Apr 22-28 fails.
    side = [
        page1,
        HTTPException(status_code=503, detail="upstream"),
        HTTPException(status_code=503, detail="upstream"),
        HTTPException(status_code=503, detail="upstream"),
    ]
    server._CUSTOMER_HIST_CACHE.clear()
    with patch.object(server, "_safe_fetch", new=AsyncMock(side_effect=side)):
        rows = asyncio.run(server._orders_for_window("2026-04-01", "2026-04-28"))
    assert len(rows) == 100


def test_split_on_failure_recovers_smaller_window():
    """Iter 84g — when a 14-day chunk times out but a 7-day chunk
    succeeds (the real-world bug observed on Vivo upstream), the
    bisect-retry must recover the data.

    Scenario: Apr 1-14 chunk times out → bisect → Apr 1-7 succeeds
    (returns 50 rows), Apr 8-14 succeeds (returns 30 rows). End result:
    80 rows from a single requested chunk that would otherwise have
    yielded zero rows."""
    import server
    from fastapi import HTTPException
    side = [
        HTTPException(status_code=503, detail="upstream timeout"),  # initial 14d attempt
        [_row(i, "2026-04-03") for i in range(50)],                  # 7-day left half
        [_row(100 + i, "2026-04-10") for i in range(30)],            # 7-day right half
    ]
    server._CUSTOMER_HIST_CACHE.clear()
    with patch.object(server, "_safe_fetch", new=AsyncMock(side_effect=side)):
        rows = asyncio.run(server._orders_for_window("2026-04-01", "2026-04-14"))
    assert len(rows) == 80, f"expected 80 (50+30) got {len(rows)}"
