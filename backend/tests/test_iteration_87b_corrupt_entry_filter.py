"""Iter 87 Phase B — corrupt-entry filter regression tests.

Validates:
1. Row-level filter at fetch() drops blocklisted /orders rows (matches by
   either order_id OR product_token).
2. Aggregate correction subtracts impact when upstream still has the
   bad row, but auto-skips when upstream has been cleaned (heuristic:
   total_sales < 80 % of impact → assume cleaned, skip correction).
3. Country/channel scoping — a Kenya-scoped corrupt entry is NOT
   subtracted from a Uganda payload.
4. Derived ratios (avg_basket_size, avg_selling_price, return_rate)
   are recomputed from the post-correction totals.
"""
from __future__ import annotations

import server


# ── Test fixtures ────────────────────────────────────────────────────

def _bad_entry(date="2026-04-24", country="Kenya", channel="Vivo Nakuru", impact=None):
    """Build a CORRUPT_ENTRIES-shaped dict for test use."""
    return {
        "date": date,
        "order_id": "16547",
        "product_token": "shopping bag",
        "country": country,
        "channel": channel,
        "impact": impact or {
            "total_sales": 712_000_000.0,
            "gross_sales": 712_000_000.0,
            "total_orders": 1,
            "total_units": 1,
        },
    }


def _swap_registry(entries):
    """Replace CORRUPT_ENTRIES for the duration of one test.
    Returns a teardown callable that restores the original."""
    original = list(server.CORRUPT_ENTRIES)
    server.CORRUPT_ENTRIES[:] = entries
    return lambda: server.CORRUPT_ENTRIES.__setitem__(slice(None), original)


# ── 1. Row-level filter ──────────────────────────────────────────────

def test_row_filter_drops_by_order_id():
    teardown = _swap_registry([_bad_entry()])
    try:
        rows = [
            {"order_id": "16547", "product_title": "Some other product"},  # matches by id
            {"order_id": "99999", "product_title": "Clean product"},
        ]
        out = server._filter_corrupt_rows(rows)
        assert len(out) == 1
        assert out[0]["order_id"] == "99999"
    finally:
        teardown()


def test_row_filter_drops_by_product_token():
    teardown = _swap_registry([_bad_entry()])
    try:
        rows = [
            {"order_id": "DIFFERENT_ID", "product_title": "Vivo Shopping Bag - Large"},
            {"order_id": "OTHER_ID", "product_name": "Plain dress"},
        ]
        out = server._filter_corrupt_rows(rows)
        assert len(out) == 1
        assert out[0]["order_id"] == "OTHER_ID"
    finally:
        teardown()


def test_row_filter_empty_registry_is_noop():
    teardown = _swap_registry([])
    try:
        rows = [{"order_id": "16547", "product_title": "shopping bag"}]
        out = server._filter_corrupt_rows(rows)
        assert out == rows
    finally:
        teardown()


def test_row_filter_handles_non_list_gracefully():
    teardown = _swap_registry([_bad_entry()])
    try:
        # Some upstream paths may return {} on auth fail — must not crash.
        assert server._filter_corrupt_rows({"error": "x"}) == {"error": "x"}
        assert server._filter_corrupt_rows(None) is None
    finally:
        teardown()


# ── 2. Aggregate correction ─────────────────────────────────────────

def test_aggregate_correction_applies_when_corrupt_present():
    """Upstream still serves the bad row (total_sales >> impact) →
    correction subtracts and recomputes ratios."""
    teardown = _swap_registry([_bad_entry()])
    try:
        # Upstream raw payload — still includes the 712M bad row.
        payload = {
            "total_sales": 716_000_000.0,
            "gross_sales": 715_000_000.0,
            "net_sales": 715_000_000.0,
            "total_returns": 100_000.0,
            "total_orders": 441,
            "total_units": 916,
        }
        out = server._apply_aggregate_correction(
            payload, date_from="2026-04-24", date_to="2026-04-24",
        )
        # ~4M after subtraction.
        assert 3_500_000 <= out["total_sales"] <= 5_000_000
        assert out["total_orders"] == 440
        assert out["total_units"] == 915
        # avg_basket recomputed from CORRECTED totals.
        assert abs(out["avg_basket_size"] - (out["total_sales"] / out["total_orders"])) < 0.01
    finally:
        teardown()


def test_aggregate_correction_skips_when_upstream_cleaned():
    """Heuristic guard — upstream value is already < impact, so we
    assume the data team cleaned the source and skip the correction
    (otherwise we'd clamp to 0)."""
    teardown = _swap_registry([_bad_entry()])
    try:
        # Upstream value AFTER cleanup — 3.83M; impact is 712M.
        # Without the guard we'd subtract → 0. With guard we keep
        # the value as-is.
        payload = {
            "total_sales": 3_828_229.0,
            "gross_sales": 3_459_591.0,
            "total_orders": 440,
            "total_units": 915,
        }
        before = dict(payload)
        out = server._apply_aggregate_correction(
            payload, date_from="2026-04-24", date_to="2026-04-24",
        )
        # No subtraction applied → payload unchanged.
        assert out["total_sales"] == before["total_sales"]
        assert out["total_orders"] == before["total_orders"]
    finally:
        teardown()


def test_aggregate_correction_country_scope_filters():
    """Kenya-scoped corrupt entry must NOT subtract from a Uganda payload."""
    teardown = _swap_registry([_bad_entry()])
    try:
        payload = {
            "total_sales": 1_000_000_000.0,  # huge — would trigger subtract
            "total_orders": 100,
            "total_units": 200,
        }
        before = dict(payload)
        out = server._apply_aggregate_correction(
            payload, date_from="2026-04-24", date_to="2026-04-24",
            country="Uganda",
        )
        assert out["total_sales"] == before["total_sales"]
        assert out["total_orders"] == before["total_orders"]
    finally:
        teardown()


def test_aggregate_correction_date_out_of_range_is_noop():
    teardown = _swap_registry([_bad_entry()])
    try:
        payload = {"total_sales": 716_000_000.0, "total_orders": 441, "total_units": 916}
        before = dict(payload)
        # Bad date is 2026-04-24; window is 2026-05-01 → 2026-05-31.
        out = server._apply_aggregate_correction(
            payload, date_from="2026-05-01", date_to="2026-05-31",
        )
        assert out == before
    finally:
        teardown()
