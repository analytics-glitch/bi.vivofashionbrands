"""Iter 72 — Smart per-entry cache TTL regression test.

The fetch cache used to apply a flat 120 s TTL to every upstream
response. With Vivo BI's materialized BigQuery layer now serving
historical date ranges as immutable data (changes happen only on
explicit edit, which is rare), keeping a 120 s TTL on historical
responses caused us to hit upstream far more often than necessary.

These tests lock in the smart-TTL policy:
  • date_to today / future  → 120 s
  • date_to == yesterday    → 600 s
  • date_to <  yesterday    → 3600 s
  • missing / malformed     → 120 s (default; safe fallback)

Iter 84 added path-specific overrides:
  • /top-customers with limit >= 50000 → 3600 s regardless of date_to
    (lifetime walk-in roster; only changes on new customer signups)
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _days_ago_iso(n: int) -> str:
    return (datetime.now(timezone.utc).date() - timedelta(days=n)).isoformat()


def test_smart_ttl_today_is_two_minutes():
    from server import _smart_ttl
    assert _smart_ttl("/kpis", {"date_to": _today_iso()}) == 120.0


def test_smart_ttl_future_is_two_minutes():
    from server import _smart_ttl
    # A future date_to (someone picks the wrong end of a range) is treated
    # as "today" — we don't want to over-cache a window that might still
    # be receiving inserts.
    assert _smart_ttl("/kpis", {"date_to": _days_ago_iso(-3)}) == 120.0


def test_smart_ttl_yesterday_is_ten_minutes():
    from server import _smart_ttl
    assert _smart_ttl("/kpis", {"date_to": _days_ago_iso(1)}) == 600.0


def test_smart_ttl_historical_is_one_hour():
    from server import _smart_ttl
    for n in (2, 7, 30, 90, 365):
        assert _smart_ttl("/kpis", {"date_to": _days_ago_iso(n)}) == 3600.0


def test_smart_ttl_missing_date_falls_back_to_default():
    from server import _smart_ttl, _FETCH_TTL
    assert _smart_ttl("/kpis", {}) == _FETCH_TTL
    assert _smart_ttl("/kpis", {"date_to": None}) == _FETCH_TTL
    assert _smart_ttl("/kpis", {"date_to": ""}) == _FETCH_TTL


def test_smart_ttl_malformed_date_falls_back_to_default():
    from server import _smart_ttl, _FETCH_TTL
    assert _smart_ttl("/kpis", {"date_to": "not-a-date"}) == _FETCH_TTL
    assert _smart_ttl("/kpis", {"date_to": "2026/05/13"}) == _FETCH_TTL
    assert _smart_ttl("/kpis", {"date_to": 20260513}) == _FETCH_TTL  # int not str


def test_top_customers_lifetime_roster_gets_one_hour_ttl():
    """Iter 84 — the lifetime walk-in roster (limit=200000) was the #1
    repeat-miss offender (98 misses/day) because date_to=today put it
    in the 120 s bucket. Force 1 h TTL for any /top-customers call with
    a high limit so the helper that parses it can re-use the same
    upstream response for the full hour."""
    from server import _smart_ttl
    today = _today_iso()
    # Lifetime roster — high limit + today's date_to: must still get 1 h.
    assert _smart_ttl(
        "/top-customers",
        {"date_from": "2025-04-10", "date_to": today, "limit": 200000},
    ) == 3600.0
    assert _smart_ttl(
        "/top-customers",
        {"date_from": "2025-04-10", "date_to": today, "limit": 50000},
    ) == 3600.0


def test_top_customers_small_limit_uses_smart_ttl_default():
    """A small `limit` on /top-customers is the regular per-store top-N
    query (limit=50). It SHOULD fall back to the date-based TTL — 120 s
    for today, 1 h for historical — like every other endpoint."""
    from server import _smart_ttl
    today = _today_iso()
    assert _smart_ttl(
        "/top-customers",
        {"date_from": today, "date_to": today, "limit": 50},
    ) == 120.0
    assert _smart_ttl(
        "/top-customers",
        {"date_from": _days_ago_iso(30), "date_to": _days_ago_iso(7), "limit": 50},
    ) == 3600.0


def test_top_customers_missing_limit_uses_default():
    """When `limit` is missing or non-numeric, the path override falls
    through to the date-based TTL — never a crash."""
    from server import _smart_ttl
    today = _today_iso()
    assert _smart_ttl(
        "/top-customers",
        {"date_from": today, "date_to": today},
    ) == 120.0
    assert _smart_ttl(
        "/top-customers",
        {"date_from": today, "date_to": today, "limit": "abc"},
    ) == 120.0
