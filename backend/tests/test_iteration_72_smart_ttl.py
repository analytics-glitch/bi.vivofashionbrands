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
    assert _smart_ttl({"date_to": _today_iso()}) == 120.0


def test_smart_ttl_future_is_two_minutes():
    from server import _smart_ttl
    # A future date_to (someone picks the wrong end of a range) is treated
    # as "today" — we don't want to over-cache a window that might still
    # be receiving inserts.
    assert _smart_ttl({"date_to": _days_ago_iso(-3)}) == 120.0


def test_smart_ttl_yesterday_is_ten_minutes():
    from server import _smart_ttl
    assert _smart_ttl({"date_to": _days_ago_iso(1)}) == 600.0


def test_smart_ttl_historical_is_one_hour():
    from server import _smart_ttl
    for n in (2, 7, 30, 90, 365):
        assert _smart_ttl({"date_to": _days_ago_iso(n)}) == 3600.0


def test_smart_ttl_missing_date_falls_back_to_default():
    from server import _smart_ttl, _FETCH_TTL
    assert _smart_ttl({}) == _FETCH_TTL
    assert _smart_ttl({"date_to": None}) == _FETCH_TTL
    assert _smart_ttl({"date_to": ""}) == _FETCH_TTL


def test_smart_ttl_malformed_date_falls_back_to_default():
    from server import _smart_ttl, _FETCH_TTL
    assert _smart_ttl({"date_to": "not-a-date"}) == _FETCH_TTL
    assert _smart_ttl({"date_to": "2026/05/13"}) == _FETCH_TTL
    assert _smart_ttl({"date_to": 20260513}) == _FETCH_TTL  # int not str
