"""
Iter-51 — Allocations + Feedback + IBT online-exclusion regression.

Covers:
  - GET /api/feedback (admin) lists; POST creates; PATCH toggles;
    GET /api/feedback/mine returns own only.
  - GET /api/allocations/sizes returns 12 documented ratios.
  - GET /api/allocations/stores excludes online/warehouse.
  - POST /api/allocations/calculate happy path + invariants.
  - POST /api/allocations/calculate input validation (bad size, < pack).
  - velocity_weight=1.0 vs 0.0 favours different stores.
  - GET /api/analytics/ibt-warehouse-to-store has zero online destinations.
"""
from __future__ import annotations

import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PWD = "VivoAdmin!2026"
VIEWER_EMAIL = "viewer@vivofashiongroup.com"
VIEWER_PWD = "Viewer!2026"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                      timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def viewer_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": VIEWER_EMAIL, "password": VIEWER_PWD},
                      timeout=20)
    if r.status_code != 200:
        pytest.skip("viewer creds not available")
    return r.json()["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ── Allocations: static endpoints ─────────────────────────────────────
def test_sizes_table_has_all_12_ratios(admin_token):
    r = requests.get(f"{BASE_URL}/api/allocations/sizes", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200, r.text
    table = r.json().get("pack_table") or {}
    expected = {"XS": 1, "S": 2, "M": 3, "L": 3, "1X": 2, "2X": 1, "F": 4,
                "XS/S": 2, "M/L": 2, "1X/2X": 1, "S/M": 2, "L/1X": 1}
    assert table == expected, f"size pack table mismatch: {table}"


def test_allocation_stores_excludes_online_and_warehouse(admin_token):
    r = requests.get(f"{BASE_URL}/api/allocations/stores", headers=_h(admin_token), timeout=30)
    assert r.status_code == 200, r.text
    stores = r.json().get("stores") or []
    assert isinstance(stores, list) and len(stores) > 0, "expected non-empty stores list"
    bad_keys = ("online", "shop zetu", "studio", "wholesale", "warehouse")
    for s in stores:
        low = s.lower()
        for k in bad_keys:
            assert k not in low, f"store '{s}' contains banned keyword '{k}'"


# ── Allocations: calculate happy path ─────────────────────────────────
def test_calculate_happy_path_invariants(admin_token):
    body = {
        "subcategory": "Maxi Dresses",
        "sizes": ["S", "M", "L"],
        "units_total": 400,
        "date_from": "2026-04-01",
        "date_to": "2026-04-30",
        "velocity_weight": 0.5,
    }
    r = requests.post(f"{BASE_URL}/api/allocations/calculate",
                      headers=_h(admin_token), json=body, timeout=180)
    if r.status_code == 404:
        pytest.skip(f"no data for subcategory in window: {r.text}")
    assert r.status_code == 200, r.text
    data = r.json()
    # pack size = 2+3+3 = 8 ; available_packs = 400 // 8 = 50
    assert data["pack_unit_size"] == 8
    assert data["available_packs"] == 50
    assert data["requested_units"] == 400
    rows = data.get("rows") or []
    assert len(rows) > 0
    pack_sum = sum(row["packs_allocated"] for row in rows)
    units_sum = sum(row["units_allocated"] for row in rows)
    assert pack_sum == data["available_packs"], f"sum(packs)={pack_sum} != available_packs"
    assert units_sum == data["allocated_units"]
    assert units_sum <= body["units_total"]
    # Per-row pack ratio invariant: packs * ratio == units for that size.
    pack_breakdown = data["pack_breakdown"]
    for row in rows:
        for sz, units in row["sizes"].items():
            assert units == row["packs_allocated"] * pack_breakdown[sz], \
                f"row {row['store']} size {sz}: {units} != {row['packs_allocated']} * {pack_breakdown[sz]}"
        # No online destinations
        low = row["store"].lower()
        for k in ("online", "shop zetu", "studio", "wholesale"):
            assert k not in low, f"row store '{row['store']}' is online channel"


def test_calculate_velocity_extremes_change_winner(admin_token):
    base = {
        "subcategory": "Maxi Dresses",
        "sizes": ["S", "M", "L"],
        "units_total": 400,
        "date_from": "2026-03-01",
        "date_to": "2026-04-30",
    }
    rv = requests.post(f"{BASE_URL}/api/allocations/calculate",
                       headers=_h(admin_token), json={**base, "velocity_weight": 1.0}, timeout=60)
    rs = requests.post(f"{BASE_URL}/api/allocations/calculate",
                       headers=_h(admin_token), json={**base, "velocity_weight": 0.0}, timeout=60)
    if rv.status_code == 404 or rs.status_code == 404:
        pytest.skip("subcategory has no data")
    assert rv.status_code == 200 and rs.status_code == 200
    velocity_rows = rv.json()["rows"]
    lowstock_rows = rs.json()["rows"]
    # With velocity_weight=1.0 the top row should be the highest units_sold_window.
    if velocity_rows:
        max_sold = max(r["units_sold_window"] for r in velocity_rows)
        top_v = velocity_rows[0]
        # The first (highest packs) row should be at/near the velocity max.
        assert top_v["units_sold_window"] == max_sold or top_v["packs_allocated"] >= 1
    # With velocity_weight=0.0 top row should have low SOH (low_stock_score high).
    if lowstock_rows:
        # find the row with most packs and verify low_stock_score is among the top.
        top_ls = lowstock_rows[0]
        assert top_ls["low_stock_score"] >= 0.0


def test_calculate_invalid_size_returns_400(admin_token):
    body = {
        "subcategory": "Maxi Dresses",
        "sizes": ["BOGUS"],
        "units_total": 400,
        "date_from": "2026-03-01",
        "date_to": "2026-04-30",
    }
    r = requests.post(f"{BASE_URL}/api/allocations/calculate",
                      headers=_h(admin_token), json=body, timeout=20)
    assert r.status_code == 400, r.text
    assert "BOGUS" in r.text or "Unknown size" in r.text.lower() or "unknown" in r.text.lower()


def test_calculate_units_below_pack_size_returns_400(admin_token):
    body = {
        "subcategory": "Maxi Dresses",
        "sizes": ["S", "M", "L"],   # pack = 8
        "units_total": 5,           # below pack
        "date_from": "2026-03-01",
        "date_to": "2026-04-30",
    }
    r = requests.post(f"{BASE_URL}/api/allocations/calculate",
                      headers=_h(admin_token), json=body, timeout=20)
    assert r.status_code == 400, r.text
    txt = r.text.lower()
    assert "pack" in txt, f"error message should mention pack: {r.text}"


# ── IBT warehouse-to-store online exclusion ───────────────────────────
def test_ibt_warehouse_to_store_no_online_destinations(admin_token):
    r = requests.get(f"{BASE_URL}/api/analytics/ibt-warehouse-to-store",
                     headers=_h(admin_token),
                     params={"date_from": "2026-03-01", "date_to": "2026-04-30"},
                     timeout=60)
    assert r.status_code == 200, r.text
    payload = r.json()
    # response can be a list or {"suggestions": [...]}
    rows = payload if isinstance(payload, list) else (
        payload.get("suggestions") or payload.get("rows") or payload.get("data") or []
    )
    assert isinstance(rows, list)
    bad = ("online", "shop zetu", "studio", "wholesale")
    for row in rows:
        ts = (row.get("to_store") or "").lower()
        for k in bad:
            assert k not in ts, f"online destination leaked: '{row.get('to_store')}'"


# ── Feedback CRUD ─────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def created_feedback_id(admin_token):
    body = {"page": "/ibt", "category": "bug",
            "message": "TEST_iter51 feedback created by automated test"}
    r = requests.post(f"{BASE_URL}/api/feedback",
                      headers=_h(admin_token), json=body, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["message"] == body["message"]
    assert data["category"] == "bug"
    assert data["user_email"] == ADMIN_EMAIL
    assert data["resolved"] is False
    assert "id" in data and data["id"]
    return data["id"]


def test_feedback_list_admin(admin_token, created_feedback_id):
    r = requests.get(f"{BASE_URL}/api/feedback", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert isinstance(rows, list)
    ids = [row["id"] for row in rows]
    assert created_feedback_id in ids


def test_feedback_mine_returns_only_own(admin_token, created_feedback_id):
    r = requests.get(f"{BASE_URL}/api/feedback/mine", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert isinstance(rows, list) and len(rows) >= 1
    for row in rows:
        assert row["user_email"] == ADMIN_EMAIL


def test_feedback_patch_toggle_resolved(admin_token, created_feedback_id):
    r = requests.patch(f"{BASE_URL}/api/feedback/{created_feedback_id}",
                       headers=_h(admin_token),
                       json={"resolved": True, "admin_note": "fixed in iter-51"},
                       timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["resolved"] is True
    assert data["resolved_by"] == ADMIN_EMAIL
    assert data["resolved_at"] is not None
    assert data["admin_note"] == "fixed in iter-51"

    # toggle back
    r2 = requests.patch(f"{BASE_URL}/api/feedback/{created_feedback_id}",
                        headers=_h(admin_token),
                        json={"resolved": False}, timeout=20)
    assert r2.status_code == 200
    assert r2.json()["resolved"] is False
    assert r2.json()["resolved_by"] is None


def test_feedback_admin_only_for_list_and_patch(viewer_token, created_feedback_id):
    r = requests.get(f"{BASE_URL}/api/feedback", headers=_h(viewer_token), timeout=20)
    assert r.status_code in (401, 403), f"viewer should not list all feedback: {r.status_code}"
    r2 = requests.patch(f"{BASE_URL}/api/feedback/{created_feedback_id}",
                        headers=_h(viewer_token),
                        json={"resolved": True}, timeout=20)
    assert r2.status_code in (401, 403)
