"""Iter 85d — /customers gracefully swallows upstream 429 (rate-limit).

The bug: when upstream `/customers` returned 429 (rate-limited), the
exception propagated through `get_customers` and the FE briefly flashed
"Upstream /customers returned 429" in the page error banner before the
client-side retry/circuit-breaker logic kicked in. End users shouldn't
see raw HTTP statuses — the same degraded-zeros pattern we use for
502/503/504 should fire for 429 too.

Fix: extend the `except HTTPException` block in `get_customers` to also
catch 429 (and 500 while we're at it). Surface the status as
`degraded_status: 429` in the response so the FE can show the
"data refreshing" badge instead of a hard error.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server  # noqa: E402
from fastapi import HTTPException  # noqa: E402


def _clear():
    """Reset snapshot + breaker so each test is hermetic."""
    if hasattr(server, "_cb_state"):
        try:
            server._cb_state.clear()
        except Exception:
            pass


def _run(coro):
    return asyncio.run(coro)


def test_customers_swallows_429():
    """Upstream 429 → graceful zeros + degraded:True + degraded_status:429."""
    async def _scenario():
        _clear()
        async def fake_snap(*a, **kw):
            return None  # no snapshot, fall through to live path
        async def fake_live(*a, **kw):
            raise HTTPException(status_code=429, detail="Upstream /customers returned 429")
        with patch.object(server, "_try_analytics_snapshot", new=AsyncMock(side_effect=fake_snap)), \
             patch.object(server, "_get_customers_live", new=AsyncMock(side_effect=fake_live)):
            return await server.get_customers(
                date_from="2026-05-17", date_to="2026-05-17",
            )

    result = _run(_scenario())
    assert result["degraded"] is True
    assert result["degraded_reason"] == "upstream_rate_limited"
    assert result["degraded_status"] == 429
    # All numeric fields zeroed safely.
    for k in ("total_customers", "new_customers", "returning_customers",
              "churned_customers", "avg_customer_spend"):
        assert result[k] == 0


def test_customers_swallows_500():
    """Upstream 500 → same degraded payload (different reason tag)."""
    async def _scenario():
        _clear()
        async def fake_snap(*a, **kw):
            return None
        async def fake_live(*a, **kw):
            raise HTTPException(status_code=500, detail="kaboom")
        with patch.object(server, "_try_analytics_snapshot", new=AsyncMock(side_effect=fake_snap)), \
             patch.object(server, "_get_customers_live", new=AsyncMock(side_effect=fake_live)):
            return await server.get_customers(
                date_from="2026-05-17", date_to="2026-05-17",
            )

    result = _run(_scenario())
    assert result["degraded"] is True
    assert result["degraded_reason"] == "upstream_unavailable"
    assert result["degraded_status"] == 500


def test_customers_503_still_handled():
    """Regression — pre-existing 502/503/504 path must still degrade."""
    async def _scenario():
        _clear()
        async def fake_snap(*a, **kw):
            return None
        async def fake_live(*a, **kw):
            raise HTTPException(status_code=503, detail="circuit open")
        with patch.object(server, "_try_analytics_snapshot", new=AsyncMock(side_effect=fake_snap)), \
             patch.object(server, "_get_customers_live", new=AsyncMock(side_effect=fake_live)):
            return await server.get_customers(
                date_from="2026-05-17", date_to="2026-05-17",
            )

    result = _run(_scenario())
    assert result["degraded"] is True
    assert result["degraded_reason"] == "upstream_unavailable"
    assert result["degraded_status"] == 503


def test_customers_400_still_raises():
    """Client errors (400, 401, 403, 404) MUST still propagate — those
    are real bugs (bad params, missing auth) the FE needs to surface
    rather than silently degrading to zeros."""
    async def _scenario():
        _clear()
        async def fake_snap(*a, **kw):
            return None
        async def fake_live(*a, **kw):
            raise HTTPException(status_code=400, detail="bad date_from")
        with patch.object(server, "_try_analytics_snapshot", new=AsyncMock(side_effect=fake_snap)), \
             patch.object(server, "_get_customers_live", new=AsyncMock(side_effect=fake_live)):
            try:
                await server.get_customers(
                    date_from="not-a-date", date_to="2026-05-17",
                )
                return None
            except HTTPException as e:
                return e

    err = _run(_scenario())
    assert isinstance(err, HTTPException), "400 must propagate, not degrade"
    assert err.status_code == 400
