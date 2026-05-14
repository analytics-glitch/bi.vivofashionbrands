"""Iter 77 — IBT no-params snapshot regression test.

Locks in the fix where calling `/api/analytics/ibt-warehouse-to-store`
with NO date_from / date_to params still hits the Mongo snapshot
(treating the no-params case as "canonical 28-day window") instead of
falling through to the live impl, which silently degrades to [] when
upstream /inventory throttles.

Also locks in that the country=None snapshot is now precomputed
alongside the per-country snapshots so the all-countries view has a
cached path.
"""
from pathlib import Path


def test_wrapper_accepts_none_date_from_to():
    """The wrapper's df_ok/dt_ok checks must accept None as 'use
    canonical'. Source sentinel — before iter 77 the checks used
    `date_from and ...` which evaluates to None (falsy) for the
    no-params case and skipped the snapshot path."""
    src = Path(__file__).resolve().parent.parent / "server.py"
    text = src.read_text()
    # Iter-77 expression that allows the no-params case through.
    assert "df_ok = (not date_from) or abs(" in text, (
        "wrapper regressed — no-params IBT will fall to live impl"
    )
    assert "dt_ok = (not date_to) or abs(" in text


def test_country_none_snapshot_is_precomputed():
    """The snapshot warmer must register an explicit country=None task
    so the all-countries view has a cached path. Before iter 77 only
    per-country snapshots existed."""
    src = Path(__file__).resolve().parent.parent / "server.py"
    text = src.read_text()
    assert (
        "date_from=df, date_to=dt, country=None,\n"
        "            limit=300, min_daily_velocity=0.2,"
    ) in text, "country=None IBT snapshot precompute task missing"
