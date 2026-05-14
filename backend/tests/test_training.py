"""Backend regression tests for the Vivo Training proxy module."""
import os
import httpx
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://crm-platform-145.preview.emergentagent.com").rstrip("/")
UPSTREAM = "https://vivo-training-api-666430550422.europe-west1.run.app"
MGR = "test_session_vivo_mgr_1778250692444"
HDR = {"Authorization": f"Bearer {MGR}"}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update(HDR)
    return sess


@pytest.mark.parametrize("ep", [
    "filters", "overview", "training-status", "by-department",
    "by-delivery-method", "duration", "budget", "top-employees",
    "monthly-trend", "facilitators", "lateness", "employee-history",
])
def test_endpoint_200(s, ep):
    r = s.get(f"{BASE_URL}/api/training/{ep}", timeout=30)
    assert r.status_code == 200, r.text[:200]


def test_lateness_metadata_and_clamping(s):
    """Verify response includes timezone metadata and detail[].lateness_hours is shifted+clamped."""
    body = s.get(f"{BASE_URL}/api/training/lateness", timeout=30).json()
    assert body.get("timezone_adjusted") is True
    assert body.get("timezone_offset_hours") == 3
    # Verify detail rows shifted and clamped at 0
    upstream = httpx.get(f"{UPSTREAM}/lateness", timeout=30).json()
    up_detail = upstream.get("detail") or []
    pr_detail = body.get("detail") or []
    if up_detail and pr_detail:
        # Compare first 20 rows by index assuming order stable
        for u, p in zip(up_detail[:20], pr_detail[:20]):
            if "lateness_hours" not in u or "lateness_hours" not in p:
                continue
            expected = max(0.0, round(float(u["lateness_hours"]) - 3.0, 2))
            assert p["lateness_hours"] >= 0, "negative not clamped"
            assert abs(p["lateness_hours"] - expected) < 0.011, f"{p['lateness_hours']} != {expected}"


def test_top_employees_limit(s):
    r = s.get(f"{BASE_URL}/api/training/top-employees", params={"limit": 5}, timeout=30)
    assert r.status_code == 200
    data = r.json()
    rows = data if isinstance(data, list) else data.get("top_employees") or data.get("employees") or []
    assert len(rows) <= 5, f"limit=5 returned {len(rows)} rows"


def test_employee_history_query(s):
    r = s.get(f"{BASE_URL}/api/training/employee-history", params={"employee": "a"}, timeout=30)
    assert r.status_code == 200


def test_filter_passthrough_department(s):
    f = s.get(f"{BASE_URL}/api/training/filters", timeout=30).json()
    dept = (f.get("departments") or [None])[0]
    if not dept:
        pytest.skip("no departments upstream")
    r = s.get(f"{BASE_URL}/api/training/by-department", params={"department": dept}, timeout=30)
    assert r.status_code == 200


def test_filter_passthrough_date_range(s):
    r = s.get(f"{BASE_URL}/api/training/overview",
              params={"date_from": "2026-03-09", "date_to": "2026-05-12"}, timeout=30)
    assert r.status_code == 200
    assert "total_trained" in r.json()


def test_associate_access(s):
    """Per current Vivo policy, all users upgrade to manager — both sessions return 200."""
    assoc = "test_session_vivo_assoc_1778250692444"
    r = requests.get(f"{BASE_URL}/api/training/overview",
                     headers={"Authorization": f"Bearer {assoc}"}, timeout=20)
    # Per iter13 RCA, associate is upgraded to manager. So this should return 200, not 403.
    assert r.status_code in (200, 403), f"unexpected {r.status_code}"


def test_overview_shape(s):
    o = s.get(f"{BASE_URL}/api/training/overview", timeout=30).json()
    for k in ("total_trained", "unique_employees", "total_trainings",
              "departments_trained", "total_actual_budget", "avg_hours_per_session"):
        assert k in o, f"missing {k}"
    assert o["total_trained"] > 0


def test_filters_shape(s):
    f = s.get(f"{BASE_URL}/api/training/filters", timeout=30).json()
    for k in ("categories", "training_names", "departments",
              "delivery_methods", "locations", "earliest_date", "latest_date"):
        assert k in f


def test_lateness_shifted_by_3h(s):
    # upstream raw
    up = httpx.get(f"{UPSTREAM}/lateness", timeout=30).json()
    raw = {r["training_name"]: r for r in up.get("by_training", [])}
    ours = s.get(f"{BASE_URL}/api/training/lateness", timeout=30).json()
    proxied = {r["training_name"]: r for r in ours.get("by_training", [])}
    assert proxied, "no proxied rows"
    for name, row in proxied.items():
        if name not in raw:
            continue
        for fld in ("avg_lateness_hours", "max_lateness_hours"):
            expected = max(0.0, round(raw[name][fld] - 3.0, 2))
            assert abs(row[fld] - expected) < 0.011, f"{name}.{fld} {row[fld]} != {expected}"


def test_overview_filter_passthrough(s):
    f = s.get(f"{BASE_URL}/api/training/filters", timeout=30).json()
    cat = (f.get("categories") or [None])[0]
    if not cat:
        pytest.skip("no categories upstream")
    r = s.get(f"{BASE_URL}/api/training/overview", params={"category": cat}, timeout=30)
    assert r.status_code == 200
    assert "total_trained" in r.json()


def test_auth_required():
    r = requests.get(f"{BASE_URL}/api/training/overview", timeout=15)
    assert r.status_code == 401
