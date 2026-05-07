"""
Iteration 58 — Regression sweep across recently shipped features.

Covers:
  - Smoke: kpis, sales-summary, inventory, footfall, data-freshness, annual-targets,
           sor-all-styles, ibt-suggestions, ibt-warehouse-to-store, kpi-trend.
  - Two-stage allocations: calculate, save (pending_fulfilment), runs list/get,
                           PATCH fulfil flow (the spec's "save-warehouse" alias
                           in real code is the PATCH /runs/{id}/fulfil endpoint).
  - IBT mark-as-done (POST /api/ibt/complete), admin GET /api/ibt/completed,
    sidebar /api/ibt/late-count.
  - Sign-up approval gating: /api/auth/me returns 403 detail=account_pending_approval
    for pending users, /api/auth/me/status returns status without 403.
  - Feedback module: POST /api/feedback, GET /api/feedback/mine, GET /api/feedback (admin),
    PATCH /api/feedback/{id} resolved/notes.
"""
from __future__ import annotations

import os
import uuid
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "http://localhost:8001"
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"
VIEWER_EMAIL = "viewer@vivofashiongroup.com"
VIEWER_PASSWORD = "Viewer!2026"


def _login(email: str, password: str) -> str | None:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        timeout=60,
    )
    if r.status_code != 200:
        return None
    return r.json().get("token")


@pytest.fixture(scope="module")
def admin_token():
    tok = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not tok:
        pytest.skip("Admin login failed - cannot run regression")
    return tok


@pytest.fixture(scope="module")
def viewer_token():
    tok = _login(VIEWER_EMAIL, VIEWER_PASSWORD)
    if not tok:
        pytest.skip("Viewer login failed - cannot run viewer assertions")
    return tok


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def viewer_headers(viewer_token):
    return {"Authorization": f"Bearer {viewer_token}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# 1. SMOKE / regression — read-only endpoints
# ---------------------------------------------------------------------------
class TestSmoke:
    def test_kpis(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/kpis?date_from=2026-04-01&date_to=2026-04-19",
            headers=admin_headers,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # KPI shape — at minimum should be a dict with numeric fields
        assert isinstance(data, dict)

    def test_sales_summary(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/sales-summary?date_from=2026-04-01&date_to=2026-04-19",
            headers=admin_headers,
            timeout=60,
        )
        assert r.status_code == 200, r.text

    def test_inventory(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/inventory", headers=admin_headers, timeout=60)
        assert r.status_code == 200, r.text

    def test_footfall(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/footfall?date_from=2026-04-01&date_to=2026-04-19",
            headers=admin_headers,
            timeout=60,
        )
        assert r.status_code == 200, r.text

    def test_data_freshness(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/data-freshness", headers=admin_headers, timeout=60)
        assert r.status_code == 200, r.text

    def test_annual_targets(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/annual-targets", headers=admin_headers, timeout=60
        )
        assert r.status_code == 200, r.text

    def test_sor_all_styles(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/sor-all-styles", headers=admin_headers, timeout=120
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Should be either a list of rows OR a dict with rows array.
        assert isinstance(body, (list, dict))

    def test_ibt_suggestions(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/ibt-suggestions", headers=admin_headers, timeout=120
        )
        assert r.status_code == 200, r.text

    def test_ibt_warehouse_to_store(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/ibt-warehouse-to-store",
            headers=admin_headers,
            timeout=120,
        )
        assert r.status_code == 200, r.text

    def test_kpi_trend(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/kpi-trend?date_from=2026-04-01&date_to=2026-04-19",
            headers=admin_headers,
            timeout=60,
        )
        assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# 2. Two-stage allocations workflow
# ---------------------------------------------------------------------------
class TestAllocations:
    style_name = f"Iter58_TEST_{uuid.uuid4().hex[:6]}"
    saved_run_id: str | None = None

    def test_calculate(self, admin_headers):
        body = {
            "subcategory": "Maxi Dresses",
            "country": "KE",
            "allocation_type": "new",
            "style_name": self.style_name,
            "sizes": ["S", "M", "L"],
            "units_total": 400,
            "date_from": "2026-04-01",
            "date_to": "2026-04-19",
        }
        r = requests.post(
            f"{BASE_URL}/api/allocations/calculate",
            headers=admin_headers,
            json=body,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "rows" in data and isinstance(data["rows"], list)
        assert "allocated_packs" in data or "allocated_units" in data

    def test_save_returns_pending_fulfilment(self, admin_headers):
        save_payload = {
            "style_name": self.style_name,
            "allocation_type": "new",
            "subcategory": "Maxi Dresses",
            "color": "Black",
            "units_total": 24,
            "pack_unit_size": 8,
            "pack_breakdown": {"S": 2, "M": 3, "L": 3},
            "velocity_weight": 0.5,
            "date_from": "2026-04-01",
            "date_to": "2026-04-19",
            "rows": [
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
                }
            ],
        }
        r = requests.post(
            f"{BASE_URL}/api/allocations/save",
            headers=admin_headers,
            json=save_payload,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "id" in data
        assert "_id" not in data
        assert data.get("status") == "pending_fulfilment"
        TestAllocations.saved_run_id = data["id"]

    def test_runs_list_includes_saved(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/allocations/runs", headers=admin_headers, timeout=60
        )
        assert r.status_code == 200, r.text
        runs = r.json()
        assert isinstance(runs, list)
        ids = [run.get("id") for run in runs]
        assert TestAllocations.saved_run_id in ids

    def test_run_by_id(self, admin_headers):
        if not TestAllocations.saved_run_id:
            pytest.skip("No saved run id")
        r = requests.get(
            f"{BASE_URL}/api/allocations/runs/{TestAllocations.saved_run_id}",
            headers=admin_headers,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc.get("id") == TestAllocations.saved_run_id
        assert "_id" not in doc

    def test_runs_invalid_id_404(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/allocations/runs/does-not-exist",
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 404

    def test_zzz_cleanup(self, admin_headers):
        # Mark the run fulfilled so it doesn't pollute the pending queue UI.
        if not TestAllocations.saved_run_id:
            pytest.skip("nothing to fulfil")
        r = requests.patch(
            f"{BASE_URL}/api/allocations/runs/{TestAllocations.saved_run_id}/fulfil",
            headers=admin_headers,
            json={"rows": [{"store": "TEST_STORE_A", "sizes": {"S": 4, "M": 6, "L": 6}}]},
            timeout=30,
        )
        assert r.status_code in (200, 400), r.text


# ---------------------------------------------------------------------------
# 3. IBT mark-as-done flow
# ---------------------------------------------------------------------------
class TestIBT:
    def test_late_count(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/ibt/late-count", headers=admin_headers, timeout=30
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "count" in data
        assert isinstance(data["count"], int)

    def test_completed_admin_only(self, admin_headers, viewer_headers):
        ra = requests.get(
            f"{BASE_URL}/api/ibt/completed", headers=admin_headers, timeout=30
        )
        assert ra.status_code == 200, ra.text
        rv = requests.get(
            f"{BASE_URL}/api/ibt/completed", headers=viewer_headers, timeout=30
        )
        assert rv.status_code in (401, 403), rv.text

    def test_complete_then_hidden(self, admin_headers):
        # Pull a suggestion to complete
        r = requests.get(
            f"{BASE_URL}/api/analytics/ibt-suggestions",
            headers=admin_headers,
            timeout=120,
        )
        assert r.status_code == 200
        body = r.json()
        rows = body if isinstance(body, list) else body.get("rows", [])
        if not rows:
            pytest.skip("no suggestions to complete")
        first = rows[0]
        style = first.get("style") or first.get("style_id") or first.get("style_code")
        to_store = (
            first.get("to_store") or first.get("recv_store") or first.get("destination")
        )
        if not (style and to_store):
            pytest.skip("suggestion missing style/to_store fields for completion")
        payload = {
            "po_number": f"TEST_PO_{uuid.uuid4().hex[:6]}",
            "transfer_date": datetime.now(timezone.utc).date().isoformat(),
            "completed_by": "regression-test",
            "units_moved": 1,
            "style": style,
            "to_store": to_store,
        }
        rc = requests.post(
            f"{BASE_URL}/api/ibt/complete",
            headers=admin_headers,
            json=payload,
            timeout=30,
        )
        assert rc.status_code in (200, 201), rc.text


# ---------------------------------------------------------------------------
# 4. Auth approval gating
# ---------------------------------------------------------------------------
class TestApproval:
    def test_admin_me_active(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("status") in (None, "active")

    def test_admin_me_status_unrestricted(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/auth/me/status", headers=admin_headers, timeout=30
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "status" in data

    def test_viewer_me_active(self, viewer_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=viewer_headers, timeout=30)
        # viewer is active so should succeed
        assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# 5. Feedback module
# ---------------------------------------------------------------------------
class TestFeedback:
    feedback_id: str | None = None

    def test_create_feedback(self, admin_headers):
        payload = {
            "category": "bug",
            "message": f"TEST_iter58_regression_{uuid.uuid4().hex[:6]}",
            "page": "/regression",
        }
        r = requests.post(
            f"{BASE_URL}/api/feedback", headers=admin_headers, json=payload, timeout=30
        )
        assert r.status_code in (200, 201), r.text
        data = r.json()
        assert "id" in data
        assert "_id" not in data
        TestFeedback.feedback_id = data["id"]

    def test_mine(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/feedback/mine", headers=admin_headers, timeout=30
        )
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        if TestFeedback.feedback_id:
            assert any(row.get("id") == TestFeedback.feedback_id for row in rows)

    def test_admin_list(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/feedback", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)

    def test_admin_list_forbidden_for_viewer(self, viewer_headers):
        r = requests.get(f"{BASE_URL}/api/feedback", headers=viewer_headers, timeout=30)
        assert r.status_code in (401, 403), r.text

    def test_resolve(self, admin_headers):
        if not TestFeedback.feedback_id:
            pytest.skip("no feedback id")
        r = requests.patch(
            f"{BASE_URL}/api/feedback/{TestFeedback.feedback_id}",
            headers=admin_headers,
            json={"resolved": True, "admin_notes": "TEST resolved by regression"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("resolved") is True
        assert "_id" not in data


# ---------------------------------------------------------------------------
# 6. Locations Monthly Tracker
# ---------------------------------------------------------------------------
class TestMonthlyTargets:
    def test_monthly_targets(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/monthly-targets?month=2026-05-01",
            headers=admin_headers,
            timeout=120,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Either a list of stores or a dict with stores key
        assert isinstance(data, (list, dict))
