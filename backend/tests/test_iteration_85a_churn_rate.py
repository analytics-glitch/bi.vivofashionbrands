"""Iter 85a — Churn-rate denominator sanity tests.

The previous /customers/churn-rate implementation divided a *lifetime*
churned-customer list by an *active-in-period* count. For narrow periods
(e.g., last 30 days) this produced churn_rate values well over 100%
(observed: 40,088%) and churned_customers > total customer base.

The fix:
  base = active_in_period + churned_in_period
  rate = clamp(churned_in_period / base, 0, 100)
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server  # noqa: E402


def _reset_state():
    server._churn_full_cache.clear()
    server._churn_neg_cache.clear()
    if hasattr(server, "_cb_state"):
        try:
            server._cb_state.clear()
        except Exception:
            pass


def test_churn_rate_never_exceeds_100_percent():
    """A lifetime churned list of 144,719 customers against a tiny
    period-active denominator must clamp to ≤100%, not the previous
    40,088%."""
    async def _scenario():
        _reset_state()
        churned_list = [
            {"id": f"c{i}", "last_purchase_date": "2024-08-15"}
            for i in range(144_719)
        ]

        async def fake_fetch(path, params=None, **kw):
            if path == "/churned-customers":
                return churned_list
            if path == "/customers":
                return {"total_customers": 361}
            return {}

        with patch.object(server, "fetch", new=AsyncMock(side_effect=fake_fetch)):
            return await server.get_customers_churn_rate(
                date_from="2024-08-01", date_to="2024-08-31",
            )

    result = asyncio.run(_scenario())
    assert result["churn_rate"] <= 100.0, (
        f"churn_rate must clamp to ≤100% (was {result['churn_rate']}%)"
    )
    assert result["churn_rate"] > 0
    assert result["churned_customers"] == 144_719
    assert result["customer_base"] == 144_719 + 361
    assert result["active_in_period"] == 361


def test_churn_rate_typical_period():
    """50 churned / (50+200) = 20%."""
    async def _scenario():
        _reset_state()
        churned_list = [
            {"id": f"c{i}", "last_purchase_date": "2024-08-15"}
            for i in range(50)
        ]

        async def fake_fetch(path, params=None, **kw):
            if path == "/churned-customers":
                return churned_list
            if path == "/customers":
                return {"total_customers": 200}
            return {}

        with patch.object(server, "fetch", new=AsyncMock(side_effect=fake_fetch)):
            return await server.get_customers_churn_rate(
                date_from="2024-08-01", date_to="2024-08-31",
            )

    result = asyncio.run(_scenario())
    assert result["churned_customers"] == 50
    assert result["active_in_period"] == 200
    assert result["customer_base"] == 250
    assert result["churn_rate"] == 20.0


def test_churn_rate_handles_timestamp_suffix():
    """`last_purchase_date` with trailing time still matches a YYYY-MM-DD bound."""
    async def _scenario():
        _reset_state()
        churned_list = [
            {"id": "a", "last_purchase_date": "2024-08-15T13:00:00Z"},  # IN
            {"id": "b", "last_purchase_date": "2024-09-01"},             # OUT
            {"id": "c", "last_purchase_date": "2024-08-31T23:59:59"},   # IN
        ]

        async def fake_fetch(path, params=None, **kw):
            if path == "/churned-customers":
                return churned_list
            if path == "/customers":
                return {"total_customers": 10}
            return {}

        with patch.object(server, "fetch", new=AsyncMock(side_effect=fake_fetch)):
            return await server.get_customers_churn_rate(
                date_from="2024-08-01", date_to="2024-08-31",
            )

    result = asyncio.run(_scenario())
    assert result["churned_customers"] == 2
    # 2 / (10 + 2) = 16.67%
    assert result["churn_rate"] == round(2 / 12 * 100, 2)
