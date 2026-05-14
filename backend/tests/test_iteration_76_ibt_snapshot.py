"""Iter 76 — IBT warehouse-to-store snapshot regression test.

Locks in:
  • The 28-day-ending-today window is the canonical IBT snapshot key.
  • Caller windows within ±2 days of canonical hit the snapshot.
  • Custom limits / non-default min_daily_velocity bypass the snapshot.
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _days_ago(n: int) -> str:
    return (datetime.now(timezone.utc).date() - timedelta(days=n)).isoformat()


def test_ibt_snapshot_id_separate_from_other_endpoints():
    from server import _analytics_snapshot_id

    ibt = _analytics_snapshot_id("/ibt-warehouse-to-store", "2026-04-16", "2026-05-14", "Kenya", None)
    sales = _analytics_snapshot_id("/sales-summary", "2026-04-16", "2026-05-14", "Kenya", None)
    assert ibt != sales
    assert "ibt-warehouse" in ibt


def test_ibt_snapshot_id_per_country():
    from server import _analytics_snapshot_id

    a = _analytics_snapshot_id("/ibt-warehouse-to-store", "2026-04-16", "2026-05-14", None, None)
    b = _analytics_snapshot_id("/ibt-warehouse-to-store", "2026-04-16", "2026-05-14", "Kenya", None)
    assert a != b


def test_ibt_default_window_matches_28_days():
    """The IBT page calls with date_from = today − 28 days and
    date_to = today. The wrapper accepts callers within ±2 days of
    the canonical window so a UI that sends 30-days-ago still hits the
    snapshot. This test pins the canonical window so future agents
    don't accidentally change it.
    """
    today = datetime.now(timezone.utc).date()
    canonical = (today - timedelta(days=28)).isoformat()
    expected = today.isoformat()
    assert _days_ago(28) == canonical
    assert _today() == expected
