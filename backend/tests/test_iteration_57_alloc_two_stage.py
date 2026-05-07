"""
Iteration 57 — two-stage Allocations (buying → warehouse fulfilment) backend tests.

Covers:
  * POST /api/allocations/save returns status='pending_fulfilment' with
    buying_/warehouse_ split per row and allocated_total mirrors suggested_total.
  * GET /api/allocations/runs?status=pending_fulfilment / fulfilled filter works.
  * PATCH /api/allocations/runs/{id}/fulfil flips status, updates rows, stamps audit.
  * PATCH on already-fulfilled run -> 400.
"""
from __future__ import annotations

import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or os.environ.get(
    "PUBLIC_URL", ""
).rstrip("/")
if not BASE_URL:
    # Fallback to internal backend if env not set in pytest shell.
    BASE_URL = "http://localhost:8001"

ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def style_name():
    # Unique TEST_ prefix so cleanup is easy
    return f"Iter57_TEST_{uuid.uuid4().hex[:8]}"


def _save_payload(style: str):
    rows = [
        {
            "store": "TEST_STORE_A",
            "suggested_packs": 2,
            "suggested_units": 16,
            "allocated_packs": 2,
            "allocated_units": 16,
            "sizes": {"S": 4, "M": 6, "L": 6},
            "score": 0.8,
            "velocity_score": 0.7,
            "low_stock_score": 0.9,
            "units_sold_window": 14,
            "current_soh": 5,
        },
        {
            "store": "TEST_STORE_B",
            "suggested_packs": 1,
            "suggested_units": 8,
            "allocated_packs": 1,
            "allocated_units": 8,
            "sizes": {"S": 2, "M": 3, "L": 3},
            "score": 0.5,
            "velocity_score": 0.4,
            "low_stock_score": 0.6,
            "units_sold_window": 7,
            "current_soh": 12,
        },
    ]
    return {
        "style_name": style,
        "allocation_type": "new",
        "subcategory": "Maxi Dresses",
        "color": "Black",
        "units_total": 24,
        "pack_unit_size": 8,
        "pack_breakdown": {"S": 2, "M": 3, "L": 3},
        "velocity_weight": 0.5,
        "date_from": "2026-01-01",
        "date_to": "2026-01-15",
        "rows": rows,
    }


@pytest.fixture(scope="module")
def saved_run(auth, style_name):
    """Create a run once, share across tests."""
    r = requests.post(
        f"{BASE_URL}/api/allocations/save",
        headers=auth,
        json=_save_payload(style_name),
        timeout=30,
    )
    assert r.status_code == 200, f"save failed: {r.status_code} {r.text}"
    doc = r.json()
    yield doc
    # Cleanup all TEST_ runs (best-effort) handled in standalone teardown below.


def test_save_returns_pending_with_buying_warehouse_split(saved_run):
    doc = saved_run
    # Status defaults to pending_fulfilment
    assert doc.get("status") == "pending_fulfilment"
    # allocated_total mirrors suggested_total initially
    assert doc.get("allocated_total") == doc.get("suggested_total")
    assert doc.get("delta_total") == 0
    # No mongo _id leakage
    assert "_id" not in doc
    # id present
    assert isinstance(doc.get("id"), str) and len(doc["id"]) > 0
    # Audit stamps
    assert doc.get("created_by_email") == ADMIN_EMAIL
    assert doc.get("fulfilled_at") is None
    assert doc.get("fulfilled_by_email") is None

    # Each row has buying_packs/buying_units/buying_sizes + warehouse_sizes/warehouse_units
    for row in doc.get("rows") or []:
        assert "buying_packs" in row
        assert "buying_units" in row
        assert "buying_sizes" in row and isinstance(row["buying_sizes"], dict)
        assert "warehouse_sizes" in row and isinstance(row["warehouse_sizes"], dict)
        assert "warehouse_units" in row
        # warehouse_sizes initially equals buying_sizes
        assert row["warehouse_sizes"] == row["buying_sizes"]
        # warehouse_units == sum(warehouse_sizes)
        assert row["warehouse_units"] == sum(int(v or 0) for v in row["warehouse_sizes"].values())


def test_runs_filter_pending(auth, saved_run):
    r = requests.get(
        f"{BASE_URL}/api/allocations/runs",
        headers=auth,
        params={"status": "pending_fulfilment"},
        timeout=30,
    )
    assert r.status_code == 200
    runs = r.json()
    assert isinstance(runs, list)
    ids = [d.get("id") for d in runs]
    assert saved_run["id"] in ids
    # Only pending should be returned
    for d in runs:
        assert d.get("status") == "pending_fulfilment"


def test_runs_filter_fulfilled_excludes_pending(auth, saved_run):
    r = requests.get(
        f"{BASE_URL}/api/allocations/runs",
        headers=auth,
        params={"status": "fulfilled"},
        timeout=30,
    )
    assert r.status_code == 200
    runs = r.json()
    for d in runs:
        assert d.get("status") == "fulfilled"
    # The newly-saved (still pending) run must NOT appear here.
    ids = [d.get("id") for d in runs]
    assert saved_run["id"] not in ids


def test_fulfil_updates_rows_and_status(auth, saved_run):
    rid = saved_run["id"]
    payload = {
        "rows": [
            {"store": "TEST_STORE_A", "sizes": {"S": 6, "M": 12, "L": 10}},   # 28 (buying was 16)
            {"store": "TEST_STORE_B", "sizes": {"S": 0, "M": 2, "L": 2}},     # 4  (buying was 8)
        ]
    }
    r = requests.patch(
        f"{BASE_URL}/api/allocations/runs/{rid}/fulfil",
        headers=auth,
        json=payload,
        timeout=30,
    )
    assert r.status_code == 200, f"fulfil failed: {r.status_code} {r.text}"
    doc = r.json()
    assert doc.get("status") == "fulfilled"
    assert doc.get("allocated_total") == 32  # 28+4
    assert doc.get("delta_total") == 32 - doc.get("suggested_total")
    assert doc.get("fulfilled_at") is not None
    assert doc.get("fulfilled_by_email") == ADMIN_EMAIL

    rows_by_store = {r["store"]: r for r in doc["rows"]}
    a = rows_by_store["TEST_STORE_A"]
    assert a["warehouse_sizes"] == {"S": 6, "M": 12, "L": 10}
    assert a["warehouse_units"] == 28
    assert a["allocated_units"] == 28
    # legacy `sizes` field kept in sync
    assert a["sizes"] == {"S": 6, "M": 12, "L": 10}
    # delta_units = warehouse_units - suggested_units (16)
    assert a["delta_units"] == 28 - 16

    b = rows_by_store["TEST_STORE_B"]
    assert b["warehouse_units"] == 4
    assert b["delta_units"] == 4 - 8

    # GET single run reflects fulfilled state too
    g = requests.get(f"{BASE_URL}/api/allocations/runs/{rid}", headers=auth, timeout=30)
    assert g.status_code == 200
    assert g.json().get("status") == "fulfilled"


def test_fulfil_already_fulfilled_returns_400(auth, saved_run):
    rid = saved_run["id"]
    # Hitting the same run again must 400
    r = requests.patch(
        f"{BASE_URL}/api/allocations/runs/{rid}/fulfil",
        headers=auth,
        json={"rows": [{"store": "TEST_STORE_A", "sizes": {"S": 1}}]},
        timeout=30,
    )
    assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"


def test_cleanup_test_runs(auth, style_name):
    """Best-effort cleanup: list runs and delete TEST_ prefixed ones via mongo direct."""
    # No DELETE endpoint exists; rely on mongo cleanup at module teardown.
    pass


def teardown_module(_module):
    """Strip every Iter57_TEST_ run we created."""
    try:
        from motor.motor_asyncio import AsyncIOMotorClient  # noqa
        import asyncio
        async def _clean():
            cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = cli[os.environ["DB_NAME"]]
            await db.allocation_runs.delete_many(
                {"style_name": {"$regex": "^Iter57_TEST_"}}
            )
            cli.close()
        asyncio.run(_clean())
    except Exception as e:
        print(f"cleanup warning: {e}")
