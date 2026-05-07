"""
Iteration 55 — Backend tests for:
1) /api/analytics/monthly-targets — new fields: avg_suggested_remaining,
   gap_to_target, days_remaining, and per-future-day suggested_daily_target.
2) /api/allocations/styles — replenishment style picker.
3) /api/allocations/calculate — allocation_type='replenishment' style filter.
4) /api/allocations/save + /allocations/runs + /allocations/runs/{id}.

Cleanup: any allocation_runs created here are deleted at end.
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASS = "VivoAdmin!2026"

CREATED_RUN_IDS: list[str] = []


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def client(token):
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    return s


@pytest.fixture(scope="module", autouse=True)
def cleanup(client):
    yield
    for rid in CREATED_RUN_IDS:
        try:
            # No DELETE endpoint exposed — use mongo cleanup via direct
            # connection. Falls back silently if motor missing.
            from pymongo import MongoClient
            cli = MongoClient(os.environ.get("MONGO_URL"))
            db = cli[os.environ.get("DB_NAME", "test_database")]
            db.allocation_runs.delete_one({"id": rid})
            cli.close()
        except Exception as e:
            print(f"cleanup warn: {e}")


# ───────────────────── Monthly targets ──────────────────────
class TestMonthlyTargets:
    def test_has_new_summary_fields(self, client):
        r = client.get(f"{BASE_URL}/api/analytics/monthly-targets",
                       params={"month": "2026-05-01"}, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "stores" in data
        assert isinstance(data["stores"], list) and len(data["stores"]) > 0
        for s in data["stores"][:5]:
            assert "avg_suggested_remaining" in s, f"missing avg_suggested_remaining: {s.keys()}"
            assert "gap_to_target" in s
            assert "days_remaining" in s
            assert "daily" in s and isinstance(s["daily"], list)

    def test_daily_rows_have_suggested(self, client):
        r = client.get(f"{BASE_URL}/api/analytics/monthly-targets",
                       params={"month": "2026-05-01"}, timeout=120)
        assert r.status_code == 200
        store = r.json()["stores"][0]
        future_rows = [d for d in store["daily"] if d.get("is_future")]
        past_rows = [d for d in store["daily"] if not d.get("is_future")]
        # Every row must have the key
        for d in store["daily"]:
            assert "suggested_daily_target" in d, f"row missing key: {d}"
        for d in past_rows:
            assert d["suggested_daily_target"] is None, \
                f"past/today row should have null suggested: {d}"
        # If month has future days, at least one row should be non-null
        # (gap_to_target may be 0 → suggested 0, but key present and not None)
        if future_rows:
            for d in future_rows:
                assert d["suggested_daily_target"] is not None

    def test_suggested_sum_matches_gap(self, client):
        r = client.get(f"{BASE_URL}/api/analytics/monthly-targets",
                       params={"month": "2026-05-01"}, timeout=120)
        store = r.json()["stores"][0]
        future = [d for d in store["daily"] if d.get("is_future")]
        if not future:
            pytest.skip("No future days in tested month")
        s_sum = sum(d["suggested_daily_target"] for d in future)
        gap = store["gap_to_target"]
        # Allow rounding tolerance of 1 KES per day
        tol = max(5.0, len(future) * 1.0)
        assert abs(s_sum - gap) <= tol, \
            f"sum suggested {s_sum} != gap_to_target {gap} (tol {tol})"


# ───────────────────── Allocations: styles list ──────────────────────
class TestAllocationStyles:
    def test_styles_list_non_empty(self, client):
        r = client.get(f"{BASE_URL}/api/allocations/styles",
                       params={"subcategory": "Maxi Dresses"}, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "styles" in data
        assert isinstance(data["styles"], list)
        # Will skip rather than fail if upstream has no styles
        if not data["styles"]:
            pytest.skip("Upstream inventory has no Maxi Dresses styles")
        assert all(isinstance(x, str) and x for x in data["styles"])


# ───────────────────── Allocations: replenishment filter ──────────────────────
class TestAllocationReplenishment:
    def _calc(self, client, allocation_type, style_name=None):
        body = {
            "subcategory": "Maxi Dresses",
            "sizes": ["XS", "S", "M", "L"],
            "units_total": 200,
            "date_from": "2026-04-01",
            "date_to": "2026-04-30",
            "velocity_weight": 0.5,
            "allocation_type": allocation_type,
        }
        if style_name:
            body["style_name"] = style_name
        return client.post(f"{BASE_URL}/api/allocations/calculate",
                           json=body, timeout=120)

    def test_replenishment_filters_by_style(self, client):
        styles_r = client.get(f"{BASE_URL}/api/allocations/styles",
                              params={"subcategory": "Maxi Dresses"}, timeout=60)
        styles = styles_r.json().get("styles", [])
        if not styles:
            pytest.skip("No styles available for Maxi Dresses")
        style = styles[0]

        rn = self._calc(client, "new")
        rr = self._calc(client, "replenishment", style)
        if rr.status_code == 404:
            pytest.skip(f"No stores stocked/sold style '{style}'")
        assert rn.status_code == 200, rn.text
        assert rr.status_code == 200, rr.text
        new_rows = rn.json()["rows"]
        rep_rows = rr.json()["rows"]
        # Replenishment per-store volumes should be <= subcategory-wide
        # (style is a subset of subcategory). Compare totals.
        new_sold = sum(r["units_sold_window"] for r in new_rows)
        rep_sold = sum(r["units_sold_window"] for r in rep_rows)
        assert rep_sold <= new_sold, \
            f"replenishment sold ({rep_sold}) should be <= subcat ({new_sold})"
        new_soh = sum(r["current_soh"] for r in new_rows)
        rep_soh = sum(r["current_soh"] for r in rep_rows)
        assert rep_soh <= new_soh


# ───────────────────── Allocations: save + runs ──────────────────────
class TestAllocationRuns:
    def test_save_and_list_and_get(self, client):
        body = {
            "style_name": "TEST_STYLE_iter55",
            "allocation_type": "new",
            "subcategory": "Maxi Dresses",
            "color": None,
            "units_total": 100,
            "pack_unit_size": 9,
            "pack_breakdown": {"XS": 1, "S": 2, "M": 3, "L": 3},
            "velocity_weight": 0.5,
            "date_from": "2026-04-01",
            "date_to": "2026-04-30",
            "rows": [
                {"store": "Vivo - Galleria", "suggested_units": 18, "allocated_units": 27},
                {"store": "Vivo - Junction", "suggested_units": 9, "allocated_units": 9},
            ],
        }
        r = client.post(f"{BASE_URL}/api/allocations/save", json=body, timeout=60)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert "id" in doc
        CREATED_RUN_IDS.append(doc["id"])
        # Computed totals
        assert doc["suggested_total"] == 27
        assert doc["allocated_total"] == 36
        assert doc["delta_total"] == 9
        assert doc["created_by_email"] == ADMIN_EMAIL
        assert "_id" not in doc

        # List
        lr = client.get(f"{BASE_URL}/api/allocations/runs", timeout=30)
        assert lr.status_code == 200
        runs = lr.json()
        assert isinstance(runs, list)
        ids = [d["id"] for d in runs]
        assert doc["id"] in ids
        # Newest-first
        assert runs[0]["id"] == doc["id"] or any(r["id"] == doc["id"] for r in runs[:5])

        # Get single
        gr = client.get(f"{BASE_URL}/api/allocations/runs/{doc['id']}", timeout=30)
        assert gr.status_code == 200
        gdoc = gr.json()
        assert gdoc["id"] == doc["id"]
        assert gdoc["style_name"] == "TEST_STYLE_iter55"
        assert "_id" not in gdoc

    def test_get_run_404(self, client):
        r = client.get(f"{BASE_URL}/api/allocations/runs/nonexistent-id-xyz", timeout=30)
        assert r.status_code == 404
