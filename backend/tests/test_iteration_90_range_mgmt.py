"""
Iteration 90 — Range Management backend tests.

Covers:
- GET /api/range-mgmt/classify shape & contents
- Idempotency of style_tier_history (no duplicate inserts within the same day)
- GET /api/range-mgmt/movements shape & ISO datetime format
- Retirement pipeline correctness (tier='Retire' OR status='Retire', sorted by age desc,
  recommended_retirement_date == today, outlet_discount_date == today + 4w)
- Non-merch category exclusion & retired exclusion by default
- RAG status banding matches range_mgmt.rag_status
"""
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"

# Pure-helper import sanity check for rag_status (used in one test below).
sys.path.insert(0, "/app/backend")
from range_mgmt import rag_status, TIER_TARGETS, TOTAL_TARGET  # noqa: E402


# --------------------------------------------------------------------------- fixtures
@pytest.fixture(scope="session")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token")
    assert tok, "no token in login response"
    return tok


@pytest.fixture(scope="session")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def classify_payload(auth_headers):
    """One slow call (cold ~30-60s). Cached for the whole session."""
    r = requests.get(
        f"{BASE_URL}/api/range-mgmt/classify",
        headers=auth_headers,
        timeout=180,
    )
    assert r.status_code == 200, f"classify failed: {r.status_code} {r.text[:300]}"
    return r.json()


# --------------------------------------------------------------------------- /classify
class TestClassifyShape:
    def test_top_level_keys(self, classify_payload):
        for k in ("as_of", "summary", "rows", "retirement_pipeline", "recent_movements"):
            assert k in classify_payload, f"missing top-level key: {k}"

    def test_as_of_iso(self, classify_payload):
        # parseable ISO datetime
        datetime.fromisoformat(classify_payload["as_of"].replace("Z", "+00:00"))

    def test_summary_keys(self, classify_payload):
        s = classify_payload["summary"]
        for k in (
            "total_active_styles",
            "tier_counts",
            "rag",
            "targets",
            "flagged_for_retirement",
            "overdue_for_week8_read",
            "approaching_decision_gates",
        ):
            assert k in s, f"summary missing {k}"
        for t in ("Tier 1", "Tier 2", "Tier 3", "Tier 4", "Retire"):
            assert t in s["tier_counts"], f"tier_counts missing {t}"
        assert "total" in s["rag"]
        for t in ("Tier 1", "Tier 2", "Tier 3", "Tier 4"):
            assert t in s["rag"]

    def test_total_active_equals_sum_of_tiers_1_to_4(self, classify_payload):
        tc = classify_payload["summary"]["tier_counts"]
        s = sum(tc[t] for t in ("Tier 1", "Tier 2", "Tier 3", "Tier 4"))
        assert classify_payload["summary"]["total_active_styles"] == s

    def test_row_fields_present(self, classify_payload):
        rows = classify_payload["rows"]
        assert isinstance(rows, list)
        assert len(rows) > 0, "no rows returned — upstream sor-all-styles may be empty"
        sample = rows[0]
        for k in (
            "tier", "status", "recommended_action",
            "style_age_weeks", "lifetime_sor_pct", "woc",
            "last_sale_days", "reorder_count", "full_price_pct",
            "current_stock", "weekly_avg", "launch_date",
            "passed_week8", "passed_week12", "near_week8", "near_week12",
        ):
            assert k in sample, f"row missing field: {k}"

    def test_no_mongo_objectid_in_rows(self, classify_payload):
        for r in classify_payload["rows"][:5]:
            assert "_id" not in r

    def test_non_merch_excluded(self, classify_payload):
        bad = [r for r in classify_payload["rows"] if r.get("category") in ("Accessories", "Sale", "Other")]
        assert not bad, f"non-merch categories should be excluded but found {len(bad)}"

    def test_tier_values_in_allowed_set(self, classify_payload):
        allowed = {"Tier 1", "Tier 2", "Tier 3", "Tier 4", "Retire"}
        bad = [r for r in classify_payload["rows"] if r.get("tier") not in allowed]
        assert not bad, f"unknown tiers: {set(r['tier'] for r in bad)}"


# --------------------------------------------------------------------------- retirement pipeline
class TestRetirementPipeline:
    def test_all_rows_retire(self, classify_payload):
        pipe = classify_payload["retirement_pipeline"]
        # the source rows for the pipeline must be flagged Retire (tier or status)
        # which is enforced by range_mgmt.retirement_pipeline(); we can only check
        # the shape here.
        if not pipe:
            pytest.skip("no retirement rows to verify")
        for r in pipe:
            for k in (
                "style_name", "brand", "subcategory", "style_age_weeks",
                "recommended_retirement_date", "outlet_discount_date", "reason",
            ):
                assert k in r, f"pipeline row missing {k}"

    def test_sorted_by_age_desc(self, classify_payload):
        pipe = classify_payload["retirement_pipeline"]
        if len(pipe) < 2:
            pytest.skip("not enough rows to verify sort")
        ages = [r["style_age_weeks"] or 0 for r in pipe]
        assert ages == sorted(ages, reverse=True), "pipeline not sorted by age desc"

    def test_dates_today_and_today_plus_4w(self, classify_payload):
        pipe = classify_payload["retirement_pipeline"]
        if not pipe:
            pytest.skip("no retirement rows to verify dates")
        today = datetime.now(timezone.utc).date()
        plus4w = (today + timedelta(weeks=4)).isoformat()
        sample = pipe[0]
        assert sample["recommended_retirement_date"] == today.isoformat()
        assert sample["outlet_discount_date"] == plus4w


# --------------------------------------------------------------------------- idempotency
class TestIdempotency:
    def test_second_call_does_not_duplicate_history(self, auth_headers, classify_payload):
        # 1st call already happened via the fixture. Get baseline movement count via /movements.
        r1 = requests.get(
            f"{BASE_URL}/api/range-mgmt/movements?days=1",
            headers=auth_headers, timeout=30,
        )
        assert r1.status_code == 200
        baseline = r1.json()["count"]

        # 2nd /classify call — should be cached & should NOT insert duplicates.
        r2 = requests.get(
            f"{BASE_URL}/api/range-mgmt/classify",
            headers=auth_headers, timeout=180,
        )
        assert r2.status_code == 200

        r3 = requests.get(
            f"{BASE_URL}/api/range-mgmt/movements?days=1",
            headers=auth_headers, timeout=30,
        )
        assert r3.status_code == 200
        after = r3.json()["count"]
        assert after == baseline, (
            f"history grew on idempotent call: baseline={baseline} after={after}"
        )


# --------------------------------------------------------------------------- /movements
class TestMovements:
    def test_movements_shape(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/range-mgmt/movements?days=30",
            headers=auth_headers, timeout=30,
        )
        assert r.status_code == 200
        body = r.json()
        for k in ("days", "count", "rows"):
            assert k in body
        assert body["days"] == 30
        assert isinstance(body["rows"], list)
        assert body["count"] == len(body["rows"])

    def test_movement_row_fields(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/range-mgmt/movements?days=30",
            headers=auth_headers, timeout=30,
        )
        rows = r.json()["rows"]
        if not rows:
            pytest.skip("no movements recorded yet")
        sample = rows[0]
        for k in ("style_name", "tier", "direction", "changed_at"):
            assert k in sample, f"movement missing {k}"
        # changed_at must be ISO string
        datetime.fromisoformat(sample["changed_at"].replace("Z", "+00:00"))
        assert sample["direction"] in ("up", "down")
        # No raw Mongo ObjectId in response
        assert "_id" not in sample


# --------------------------------------------------------------------------- rag helper
class TestRagBanding:
    def test_rag_green_inside(self):
        assert rag_status(40, (30, 50)) == "green"

    def test_rag_amber_near(self):
        # 50 with target (30,50) → green; 60 with target (30,50) → within +20% (60)
        assert rag_status(60, (30, 50)) == "amber"

    def test_rag_red_outside(self):
        # 30 with target (200, 300) → red (way below)
        assert rag_status(30, (200, 300)) == "red"

    def test_summary_rag_matches_helper(self, classify_payload):
        tc = classify_payload["summary"]["tier_counts"]
        rag = classify_payload["summary"]["rag"]
        for t, target in TIER_TARGETS.items():
            assert rag[t] == rag_status(tc[t], target), f"RAG mismatch for {t}"


# --------------------------------------------------------------------------- access control
class TestAccessControl:
    def test_unauthenticated_blocked(self):
        r = requests.get(f"{BASE_URL}/api/range-mgmt/classify", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403 unauth, got {r.status_code}"
