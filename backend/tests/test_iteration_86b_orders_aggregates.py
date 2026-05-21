"""Iter 86b — /orders pre-computation: walk-ins migration + customer
roster.

This file pins the contract of the new Mongo collections:
  - orders_daily_snapshots          → walk-ins fast path
  - customer_lifetime_roster        → /top-customers replacement

The bug class we're guarding against: silent regressions where the
fast-path Mongo aggregate diverges from the live /orders fan-out
result (which is still the source of truth). We test the reducer
function head-on with a synthetic input, then verify the aggregate
reader correctly returns None when a day is missing (so the fallback
kicks in).
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from orders_aggregates import (  # noqa: E402
    build_daily_doc,
    build_customer_lifetime_doc,
    read_walkins_aggregate,
    read_customer_name_lookup,
    _enum_days,
)


def _is_walk(r, loc):  # simple stub for tests — real impl in server.py
    cid = r.get("customer_id")
    return not cid or (isinstance(cid, str) and not cid.strip())


# ── build_daily_doc ──────────────────────────────────────────────────

def test_build_daily_doc_dedups_orders():
    """Upstream returns one ROW per line item. The aggregate must
    de-duplicate to ORDERS (not line items)."""
    rows = [
        {"order_id": "o1", "customer_id": "c1", "quantity": 1, "total_sales_kes": 1000.0, "pos_location_name": "X", "channel": "Retail"},
        {"order_id": "o1", "customer_id": "c1", "quantity": 1, "total_sales_kes": 500.0, "pos_location_name": "X", "channel": "Retail"},
        {"order_id": "o2", "customer_id": None, "quantity": 2, "total_sales_kes": 2000.0, "pos_location_name": "X", "channel": "Retail"},
    ]
    doc = build_daily_doc(d="2026-05-20", country="Kenya", rows=rows, is_walk_in_fn=_is_walk)
    assert doc["total_orders"] == 2   # o1 + o2, NOT 3 line items
    assert doc["total_units"] == 4    # 1+1+2 (units accumulate per line)
    assert doc["total_sales_kes"] == 3500.0
    assert doc["walk_in_orders"] == 1     # only o2
    assert doc["walk_in_units"] == 2
    assert doc["walk_in_sales_kes"] == 2000.0


def test_build_daily_doc_walkin_only_when_flagged():
    rows = [
        {"order_id": "o1", "customer_id": "c1", "quantity": 1, "total_sales_kes": 100.0, "pos_location_name": "L", "channel": "Retail"},
        {"order_id": "o2", "customer_id": "", "quantity": 1, "total_sales_kes": 200.0, "pos_location_name": "L", "channel": "Retail"},
    ]
    doc = build_daily_doc(d="2026-05-20", country="Kenya", rows=rows, is_walk_in_fn=_is_walk)
    assert doc["walk_in_orders"] == 1
    assert doc["total_orders"] == 2


def test_build_daily_doc_emits_by_customer_with_type():
    """Iter 86d Phase 2 — every non-empty customer_id gets a row in
    `by_customer` with type vote applied (Returning wins ties).
    """
    rows = [
        {"order_id": "o1", "customer_id": "c1", "customer_type": "New",
         "quantity": 2, "total_sales_kes": 1000.0, "pos_location_name": "L", "channel": "Retail"},
        {"order_id": "o2", "customer_id": "c1", "customer_type": "Returning",
         "quantity": 1, "total_sales_kes": 500.0, "pos_location_name": "L", "channel": "Retail"},
        {"order_id": "o3", "customer_id": "c2", "customer_type": "New",
         "quantity": 1, "total_sales_kes": 250.0, "pos_location_name": "L", "channel": "Retail"},
    ]
    doc = build_daily_doc(d="2026-05-20", country="Kenya", rows=rows, is_walk_in_fn=_is_walk)
    by_c = {x["customer_id"]: x for x in doc["by_customer"]}
    assert set(by_c.keys()) == {"c1", "c2"}
    # c1 — 1 New, 1 Returning → tie → Returning wins.
    assert by_c["c1"]["customer_type"] == "Returning"
    assert by_c["c1"]["orders"] == 2
    assert by_c["c1"]["sales_kes"] == 1500.0
    assert by_c["c1"]["is_walk_in"] is False
    # c2 — only New.
    assert by_c["c2"]["customer_type"] == "New"
    assert by_c["c2"]["orders"] == 1


def test_build_daily_doc_skips_blank_customer_id_in_by_customer():
    """Walk-in rows have customer_id="" — their data is already in
    walk_in_* totals. Don't pollute by_customer with empty-key rows."""
    rows = [
        {"order_id": "o1", "customer_id": "", "quantity": 1,
         "total_sales_kes": 100.0, "pos_location_name": "L", "channel": "Retail"},
    ]
    doc = build_daily_doc(d="2026-05-20", country="Kenya", rows=rows, is_walk_in_fn=_is_walk)
    assert doc["by_customer"] == []
    assert doc["walk_in_orders"] == 1


def test_read_avg_spend_aggregates_correctly():
    """Phase 2 reader rolls up per-customer across the window and
    splits into New vs Returning buckets with the standard metrics."""
    from orders_aggregates import read_avg_spend_aggregate
    # Two days, all 4 countries — sparse data, only Kenya has customers.
    base_doc = lambda d, c: {
        "date": d, "country": c, "total_orders": 0, "total_units": 0,
        "total_sales_kes": 0.0, "walk_in_orders": 0, "walk_in_units": 0,
        "walk_in_sales_kes": 0.0, "by_location": [], "by_customer": [],
    }
    rows = []
    for d in ("2026-05-19", "2026-05-20"):
        for c in ("Kenya", "Uganda", "Rwanda", "Online"):
            doc = base_doc(d, c)
            if c == "Kenya":
                # c1 (Returning): 1 order/day, 2 orders total, KES 3000 total
                # c2 (New): 1 order on May 19 only, KES 800 total
                if d == "2026-05-19":
                    doc["by_customer"] = [
                        {"customer_id": "c1", "customer_type": "Returning", "orders": 1, "units": 2, "sales_kes": 1000.0, "is_walk_in": False},
                        {"customer_id": "c2", "customer_type": "New", "orders": 1, "units": 1, "sales_kes": 800.0, "is_walk_in": False},
                    ]
                else:
                    doc["by_customer"] = [
                        {"customer_id": "c1", "customer_type": "Returning", "orders": 1, "units": 3, "sales_kes": 2000.0, "is_walk_in": False},
                    ]
            rows.append(doc)
    db = _fake_db(rows)
    out = asyncio.run(read_avg_spend_aggregate(
        db, date_from="2026-05-19", date_to="2026-05-20",
        countries=None, channels=None,
    ))
    assert out is not None
    assert out["source"] == "mongo_aggregate"
    # c1 Returning: 1 customer, 2 orders, KES 3000.
    assert out["returning"]["customers"] == 1
    assert out["returning"]["orders"] == 2
    assert out["returning"]["total_spend_kes"] == 3000.0
    assert out["returning"]["avg_spend_per_customer_kes"] == 3000.0
    assert out["returning"]["avg_orders_per_customer"] == 2.0
    # c2 New: 1 customer, 1 order, KES 800.
    assert out["new"]["customers"] == 1
    assert out["new"]["orders"] == 1
    assert out["new"]["total_spend_kes"] == 800.0


def test_read_avg_spend_excludes_walkins():
    """Walk-in entries in by_customer must be skipped — they belong to
    the unattributed bucket, not New / Returning."""
    from orders_aggregates import read_avg_spend_aggregate
    base = {
        "date": "2026-05-20", "country": "Kenya", "total_orders": 0, "total_units": 0,
        "total_sales_kes": 0.0, "walk_in_orders": 0, "walk_in_units": 0,
        "walk_in_sales_kes": 0.0, "by_location": [],
        "by_customer": [
            {"customer_id": "c1", "customer_type": "New", "orders": 1, "units": 1, "sales_kes": 500.0, "is_walk_in": False},
            {"customer_id": "c2", "customer_type": "Returning", "orders": 3, "units": 5, "sales_kes": 9000.0, "is_walk_in": True},
        ],
    }
    rows = [dict(base)]
    for c in ("Uganda", "Rwanda", "Online"):
        rows.append({**base, "country": c, "by_customer": []})
    db = _fake_db(rows)
    out = asyncio.run(read_avg_spend_aggregate(
        db, date_from="2026-05-20", date_to="2026-05-20",
        countries=None, channels=None,
    ))
    assert out["new"]["customers"] == 1
    assert out["returning"]["customers"] == 0   # the walk-in c2 was excluded


def test_read_avg_spend_returns_none_on_missing_day():
    """Coverage check — falls through to live path if any (day, country)
    missing."""
    from orders_aggregates import read_avg_spend_aggregate
    rows = [{"date": "2026-05-20", "country": "Kenya",
             "total_orders": 0, "total_units": 0, "total_sales_kes": 0.0,
             "walk_in_orders": 0, "walk_in_units": 0, "walk_in_sales_kes": 0.0,
             "by_location": [], "by_customer": []}]  # Other 3 countries missing.
    db = _fake_db(rows)
    out = asyncio.run(read_avg_spend_aggregate(
        db, date_from="2026-05-20", date_to="2026-05-20",
        countries=None, channels=None,
    ))
    assert out is None


def test_build_daily_doc_empty():
    doc = build_daily_doc(d="2026-05-20", country="Kenya", rows=[], is_walk_in_fn=_is_walk)
    assert doc["total_orders"] == 0
    assert doc["walk_in_orders"] == 0
    assert doc["by_location"] == []


# ── _enum_days ───────────────────────────────────────────────────────

def test_enum_days_inclusive_range():
    assert _enum_days("2026-05-18", "2026-05-20") == [
        "2026-05-18", "2026-05-19", "2026-05-20",
    ]
    assert _enum_days("2026-05-20", "2026-05-20") == ["2026-05-20"]


# ── read_walkins_aggregate ──────────────────────────────────────────

class _FakeCursor:
    """Tiny stand-in for a motor cursor — yields the rows passed at
    construction time."""
    def __init__(self, rows):
        self._rows = rows

    async def to_list(self, length=None):
        return list(self._rows)


def _fake_db(snapshots_rows):
    db = MagicMock()
    db.orders_daily_snapshots.find = MagicMock(return_value=_FakeCursor(snapshots_rows))
    return db


def test_read_walkins_returns_none_when_any_day_missing():
    """Coverage check — if even ONE day×country is missing, the
    aggregate read must return None so the caller falls through to
    the live path."""
    rows = [
        {"date": "2026-05-20", "country": "Kenya",
         "total_orders": 5, "walk_in_orders": 1, "total_sales_kes": 100.0,
         "walk_in_sales_kes": 20.0, "total_units": 8, "walk_in_units": 2,
         "by_location": []},
        # Missing Uganda, Rwanda, Online for this day.
    ]
    db = _fake_db(rows)
    out = asyncio.run(read_walkins_aggregate(
        db, date_from="2026-05-20", date_to="2026-05-20",
        countries=None, channels=None,
    ))
    assert out is None


def test_read_walkins_aggregates_correctly():
    """Happy path — all 4 countries present, totals + share% computed."""
    rows = [
        {"date": "2026-05-20", "country": "Kenya",
         "total_orders": 300, "walk_in_orders": 47,
         "total_sales_kes": 2_830_000.0, "walk_in_sales_kes": 409_000.0,
         "total_units": 600, "walk_in_units": 89,
         "by_location": [{
             "pos_location_name": "Vivo Sarit", "channel": "Retail",
             "total_orders": 24, "walk_in_orders": 4,
             "total_sales_kes": 100_000, "walk_in_sales_kes": 57_000,
             "total_units": 50, "walk_in_units": 8,
         }]},
        {"date": "2026-05-20", "country": "Uganda",
         "total_orders": 50, "walk_in_orders": 10,
         "total_sales_kes": 500_000.0, "walk_in_sales_kes": 60_000.0,
         "total_units": 100, "walk_in_units": 15, "by_location": []},
        {"date": "2026-05-20", "country": "Rwanda",
         "total_orders": 30, "walk_in_orders": 9,
         "total_sales_kes": 200_000.0, "walk_in_sales_kes": 50_000.0,
         "total_units": 60, "walk_in_units": 14, "by_location": []},
        {"date": "2026-05-20", "country": "Online",
         "total_orders": 100, "walk_in_orders": 46,
         "total_sales_kes": 800_000.0, "walk_in_sales_kes": 280_000.0,
         "total_units": 200, "walk_in_units": 80, "by_location": []},
    ]
    db = _fake_db(rows)
    out = asyncio.run(read_walkins_aggregate(
        db, date_from="2026-05-20", date_to="2026-05-20",
        countries=None, channels=None,
    ))
    assert out is not None
    assert out["walk_in_orders"] == 47 + 10 + 9 + 46
    assert out["total_orders"] == 300 + 50 + 30 + 100
    # Country breakdown order is alphabetical.
    countries = [r["country"] for r in out["by_country"]]
    assert countries == ["Kenya", "Online", "Rwanda", "Uganda"]
    # Share %s computed.
    kenya = next(r for r in out["by_country"] if r["country"] == "Kenya")
    assert kenya["walk_in_share_orders_pct"] == round(47 / 300 * 100, 2)
    assert out["source"] == "mongo_aggregate"


def test_read_walkins_country_filter():
    """Country=Kenya restricts the aggregate to just that slice."""
    rows = [
        {"date": "2026-05-20", "country": "Kenya",
         "total_orders": 300, "walk_in_orders": 47,
         "total_sales_kes": 2_830_000.0, "walk_in_sales_kes": 409_000.0,
         "total_units": 600, "walk_in_units": 89, "by_location": []},
        {"date": "2026-05-20", "country": "Uganda",
         "total_orders": 50, "walk_in_orders": 10,
         "total_sales_kes": 500_000.0, "walk_in_sales_kes": 60_000.0,
         "total_units": 100, "walk_in_units": 15, "by_location": []},
        {"date": "2026-05-20", "country": "Rwanda",
         "total_orders": 30, "walk_in_orders": 9,
         "total_sales_kes": 200_000.0, "walk_in_sales_kes": 50_000.0,
         "total_units": 60, "walk_in_units": 14, "by_location": []},
        {"date": "2026-05-20", "country": "Online",
         "total_orders": 100, "walk_in_orders": 46,
         "total_sales_kes": 800_000.0, "walk_in_sales_kes": 280_000.0,
         "total_units": 200, "walk_in_units": 80, "by_location": []},
    ]
    db = _fake_db(rows)
    out = asyncio.run(read_walkins_aggregate(
        db, date_from="2026-05-20", date_to="2026-05-20",
        countries=["Kenya"], channels=None,
    ))
    assert out["walk_in_orders"] == 47
    assert out["total_orders"] == 300
    assert len(out["by_country"]) == 1
    assert out["by_country"][0]["country"] == "Kenya"


# ── build_customer_lifetime_doc ─────────────────────────────────────

def test_lifetime_roster_doc_shape():
    row = {
        "customer_id": "  abc-123  ",
        "customer_name": "  Jane Doe  ",
        "phone": "+254700000000",
        "email": "",
        "first_purchase_date": "2024-08-15T13:00:00Z",
        "last_purchase_date": "2026-05-10",
        "orders": 7, "units": 12, "total_sales_kes": 99_900.0,
        "country": "Kenya",
    }
    d = build_customer_lifetime_doc(row)
    assert d["customer_id"] == "abc-123"
    assert d["customer_name"] == "Jane Doe"
    assert d["first_purchase_date"] == "2024-08-15"  # time suffix stripped
    assert d["last_purchase_date"] == "2026-05-10"
    assert d["lifetime_orders"] == 7
    assert d["lifetime_sales_kes"] == 99_900.0
    assert d["has_phone"] is True
    assert d["has_email"] is False


def test_lifetime_roster_handles_blank_name():
    """Empty-name rows are the walk-in roster (~379 IDs). They MUST be
    preserved as empty string, not dropped — `_is_walk_in_order` keys
    on this sentinel."""
    row = {"customer_id": "blank-1", "customer_name": "",
           "orders": 1, "total_sales_kes": 50.0}
    d = build_customer_lifetime_doc(row)
    assert d["customer_id"] == "blank-1"
    assert d["customer_name"] == ""
    assert d["lifetime_orders"] == 1


def test_read_customer_name_lookup_loads_roster():
    """The Mongo roster reader must return (id→name, id→{phone,email})
    so the existing walk-in detector code path is byte-for-byte
    compatible."""
    class _Cursor:
        def __init__(self, docs):
            self._docs = docs
            self._i = 0
        def __aiter__(self):
            self._i = 0
            return self
        async def __anext__(self):
            if self._i >= len(self._docs):
                raise StopAsyncIteration
            d = self._docs[self._i]
            self._i += 1
            return d

    docs = [
        {"customer_id": "a", "customer_name": "Alice", "has_phone": True, "has_email": False},
        {"customer_id": "b", "customer_name": "", "has_phone": False, "has_email": False},
    ]
    db = MagicMock()
    db.customer_lifetime_roster.find = MagicMock(return_value=_Cursor(docs))
    names, contacts = asyncio.run(read_customer_name_lookup(db))
    assert names == {"a": "Alice", "b": ""}
    assert contacts["a"] == {"has_phone": True, "has_email": False}
    assert contacts["b"] == {"has_phone": False, "has_email": False}
