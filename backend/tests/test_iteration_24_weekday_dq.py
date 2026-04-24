"""Iteration 24 – tests for:
  1. GET /api/footfall/weekday-pattern (auth required, shape, cache)
  2. Recommendations with item_type='dq' (POST/GET/DELETE)
  3. Regression on existing item_type='reorder' and 'ibt'
"""
import os
import time
import pytest
import requests

def _load_base_url():
    u = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if not u:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        u = line.split("=", 1)[1].strip()
                        break
        except FileNotFoundError:
            pass
    return u.rstrip("/")


BASE_URL = _load_base_url()
assert BASE_URL, "REACT_APP_BACKEND_URL missing"
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# 1. Weekday-pattern endpoint
# ---------------------------------------------------------------------------
class TestWeekdayPattern:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/footfall/weekday-pattern", timeout=15)
        assert r.status_code in (401, 403), (
            f"expected 401/403 without auth, got {r.status_code}")

    def test_default_window_shape(self, headers):
        r = requests.get(f"{BASE_URL}/api/footfall/weekday-pattern",
                         headers=headers, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()

        # Top-level
        assert set(["window", "locations", "rows", "group_avg_by_weekday"]).issubset(data.keys())

        # Window
        w = data["window"]
        assert {"start", "end", "days"}.issubset(w.keys())
        assert w["days"] == 28, f"expected 28-day default window, got {w['days']}"

        # locations list matches rows
        assert isinstance(data["locations"], list)
        assert isinstance(data["rows"], list)
        assert len(data["rows"]) > 0
        assert data["locations"] == [r["location"] for r in data["rows"]]

        # row shape
        first = data["rows"][0]
        assert {"location", "avg_footfall", "avg_conversion_rate",
                "total_footfall_window", "by_weekday"}.issubset(first.keys())
        assert len(first["by_weekday"]) == 7
        for wd in first["by_weekday"]:
            assert {"weekday", "avg_footfall", "avg_orders",
                    "avg_conversion_rate", "days"}.issubset(wd.keys())

        # rows sorted desc by total_footfall_window
        totals = [r["total_footfall_window"] for r in data["rows"]]
        assert totals == sorted(totals, reverse=True), "rows not sorted desc by total_footfall_window"

        # group_avg_by_weekday – 7 items, each with ~4 days sample in a 28-day window
        assert len(data["group_avg_by_weekday"]) == 7
        days_per_wk = [d["days"] for d in data["group_avg_by_weekday"]]
        # With a 28-day trailing window every weekday should have 4 samples
        assert all(d == 4 for d in days_per_wk), f"expected 4 per weekday, got {days_per_wk}"

        # No _id leakage
        assert "_id" not in r.text

    def test_cache_second_call_fast(self, headers):
        # First call warms cache; second should return in <1s
        requests.get(f"{BASE_URL}/api/footfall/weekday-pattern", headers=headers, timeout=60)
        t0 = time.time()
        r = requests.get(f"{BASE_URL}/api/footfall/weekday-pattern", headers=headers, timeout=60)
        elapsed = time.time() - t0
        assert r.status_code == 200
        assert elapsed < 2.0, f"second call should be cached (<2s) — took {elapsed:.2f}s"

    def test_invalid_dates(self, headers):
        r = requests.get(f"{BASE_URL}/api/footfall/weekday-pattern?date_from=not-a-date",
                         headers=headers, timeout=15)
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# 2. Recommendations with item_type='dq'
# ---------------------------------------------------------------------------
class TestRecommendationsDQ:
    TEST_KEY = "TEST_conversion_rate::Vivo Junction"

    def _cleanup(self, headers):
        requests.delete(
            f"{BASE_URL}/api/recommendations?item_type=dq&item_key={requests.utils.quote(self.TEST_KEY)}",
            headers=headers, timeout=15,
        )

    def test_post_get_delete_dq(self, headers):
        self._cleanup(headers)

        # POST
        payload = {"item_type": "dq", "item_key": self.TEST_KEY, "status": "po_raised",
                   "note": "TEST_iter24"}
        r = requests.post(f"{BASE_URL}/api/recommendations",
                          json=payload, headers=headers, timeout=15)
        assert r.status_code in (200, 201), r.text
        created = r.json()
        assert created["item_type"] == "dq"
        assert created["item_key"] == self.TEST_KEY
        assert created.get("status") == "po_raised"
        assert "_id" not in r.text

        # GET
        r = requests.get(f"{BASE_URL}/api/recommendations?item_type=dq",
                         headers=headers, timeout=15)
        assert r.status_code == 200
        body = r.json()
        # Response may be list or dict-of-items; accept both
        items = body if isinstance(body, list) else body.get("items", [])
        keys = [it.get("item_key") for it in items]
        assert self.TEST_KEY in keys, f"POSTed dq flag missing from GET: {keys}"

        # DELETE
        r = requests.delete(
            f"{BASE_URL}/api/recommendations?item_type=dq&item_key={requests.utils.quote(self.TEST_KEY)}",
            headers=headers, timeout=15,
        )
        assert r.status_code in (200, 204), r.text

        # Confirm gone
        r = requests.get(f"{BASE_URL}/api/recommendations?item_type=dq",
                         headers=headers, timeout=15)
        body = r.json()
        items = body if isinstance(body, list) else body.get("items", [])
        keys = [it.get("item_key") for it in items]
        assert self.TEST_KEY not in keys

    def test_reorder_and_ibt_still_work(self, headers):
        for it in ("reorder", "ibt"):
            r = requests.get(f"{BASE_URL}/api/recommendations?item_type={it}",
                             headers=headers, timeout=15)
            assert r.status_code == 200, f"{it} broken: {r.status_code} {r.text}"

    def test_rejects_unknown_item_type(self, headers):
        r = requests.get(f"{BASE_URL}/api/recommendations?item_type=bogus",
                         headers=headers, timeout=15)
        assert r.status_code in (400, 422)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
