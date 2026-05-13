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
    "health", "filters", "overview", "training-status", "by-department",
    "by-delivery-method", "duration", "budget", "top-employees",
    "monthly-trend", "facilitators", "lateness",
])
def test_endpoint_200(s, ep):
    r = s.get(f"{BASE_URL}/api/training/{ep}", timeout=30)
    assert r.status_code == 200, r.text[:200]


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
