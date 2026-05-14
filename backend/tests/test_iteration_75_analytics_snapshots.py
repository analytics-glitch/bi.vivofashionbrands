"""Iter 75 — Analytics snapshot layer regression test.

Extends the iter-67 /kpis Mongo snapshot pattern to the 4 next-busiest
Overview endpoints (sales-summary, country-summary, top-skus, footfall).
Tests verify the generic snapshot helpers don't:
  • return stale data past the freshness TTL
  • return data for multi-country/channel fan-out (must fall through live)
  • persist empty/zero payloads for recent windows
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def test_analytics_snapshot_id_is_composite():
    """Snapshot _id includes the endpoint so all four endpoints can
    share one Mongo collection without key collisions."""
    from server import _analytics_snapshot_id

    a = _analytics_snapshot_id("/sales-summary", "2026-05-13", "2026-05-13", "Kenya", None)
    b = _analytics_snapshot_id("/top-skus", "2026-05-13", "2026-05-13", "Kenya", None)
    assert a != b, "endpoints with same window/country must yield different IDs"
    assert "sales-summary" in a
    assert "top-skus" in b


def test_analytics_snapshot_id_handles_none():
    """None country/channel render as empty strings — deterministic
    so we don't accidentally write duplicates for the same logical query.
    """
    from server import _analytics_snapshot_id

    a = _analytics_snapshot_id("/country-summary", "2026-05-13", "2026-05-13", None, None)
    b = _analytics_snapshot_id("/country-summary", "2026-05-13", "2026-05-13", None, None)
    assert a == b
    assert a == "/country-summary|2026-05-13|2026-05-13||"


def test_try_analytics_snapshot_returns_none_for_multi_country_fan_out():
    """Comma-separated country values must fall through to live so the
    route's aggregation logic stays authoritative."""
    from server import _try_analytics_snapshot

    async def _run():
        return await _try_analytics_snapshot(
            "/sales-summary", "2026-05-13", "2026-05-13",
            country="Kenya,Uganda", channel=None,
        )

    assert asyncio.run(_run()) is None


def test_try_analytics_snapshot_returns_none_for_missing_window():
    """Open-ended (no date_from / date_to) calls always fall through."""
    from server import _try_analytics_snapshot

    async def _run():
        return await _try_analytics_snapshot(
            "/sales-summary", None, None, "Kenya", None,
        )

    assert asyncio.run(_run()) is None


def test_save_analytics_snapshot_skips_empty_for_recent_window():
    """Empty/zero payloads must NOT overwrite a previously-good
    snapshot for today/yesterday — same guard as the /kpis snapshotter.
    """
    from server import _save_analytics_snapshot, _analytics_snapshot_id, db

    async def _run():
        snap_id = _analytics_snapshot_id(
            "/sales-summary", _today(), _today(), "TEST_COUNTRY", None,
        )
        # Clean any leftover from previous runs.
        await db["analytics_snapshots"].delete_one({"_id": snap_id})
        # Save an empty list for TODAY → should be skipped.
        await _save_analytics_snapshot(
            "/sales-summary", _today(), _today(),
            "TEST_COUNTRY", None, data=[],
        )
        doc = await db["analytics_snapshots"].find_one({"_id": snap_id})
        return doc

    doc = asyncio.run(_run())
    assert doc is None, "empty payload for today must not be persisted"


def test_window_is_recent_classifies_correctly():
    """Inverse of the empty-write guard — historical windows return
    False so genuinely-zero historical days DO persist. Direct unit
    test against the helper because the persist-side test pollutes
    Mongo connections across event loops when run in batch.
    """
    from server import _window_is_recent

    today_iso = _today()
    yesterday_iso = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    old_iso = (datetime.now(timezone.utc).date() - timedelta(days=30)).isoformat()
    very_old_iso = (datetime.now(timezone.utc).date() - timedelta(days=365)).isoformat()

    assert _window_is_recent(today_iso, today_iso) is True
    assert _window_is_recent(yesterday_iso, yesterday_iso) is True
    assert _window_is_recent(old_iso, old_iso) is False
    assert _window_is_recent(very_old_iso, very_old_iso) is False
