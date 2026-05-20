"""Iter 85a — Live API checks (run against deployed REACT_APP_BACKEND_URL).

These complement test_iteration_85a_churn_rate.py (unit, mocked) by
hitting the *live* backend to verify response shape and that other
endpoints in the review request still work.

Tests gracefully skip when upstream is in negative-cache / breaker-open
state — that is the documented graceful-degradation path, NOT a
regression.
"""
from __future__ import annotations

import os
import time
import requests
import pytest

# Resolve backend URL from env (fall back to the frontend .env file)
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        for line in open(env_path):
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
BASE_URL = (BASE_URL or "").rstrip("/")

ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"


@pytest.fixture(scope="session")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token")
    assert tok, "token missing"
    return tok


@pytest.fixture(scope="session")
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


# --- Churn-rate live shape -------------------------------------------------
def test_churn_rate_shape_and_clamp(client):
    r = client.get(
        f"{BASE_URL}/api/customers/churn-rate",
        params={"date_from": "2024-08-01", "date_to": "2024-08-31"},
        timeout=30,
    )
    assert r.status_code == 200, r.text[:200]
    data = r.json()
    assert "churn_rate" in data
    assert "churned_customers" in data
    assert "churn_source" in data
    src = data["churn_source"]
    # When upstream is healthy, response MUST include new fields & sane math.
    if src in ("upstream_90d", "upstream_90d_cached"):
        assert "active_in_period" in data, "Iter 85a field missing"
        assert "customer_base" in data, "Iter 85a field missing"
        assert 0 <= data["churn_rate"] <= 100, (
            f"churn_rate out of [0,100]: {data['churn_rate']}"
        )
        assert data["churned_customers"] <= data["customer_base"], (
            "churned > customer_base — Iter 85a math regression"
        )
    else:
        # graceful-degradation path
        assert data["churn_rate"] == 0
        assert data["churned_customers"] == 0


# --- Customers endpoint: no 504 leak --------------------------------------
def test_customers_does_not_leak_504(client):
    """Per review brief: /api/customers must NOT propagate a raw 504.
    Acceptable: 200 (with possibly degraded zeros) or a non-504 error.
    """
    # Retry a couple times — upstream may briefly 429.
    last = None
    for _ in range(3):
        r = client.get(f"{BASE_URL}/api/customers", timeout=45)
        last = r
        if r.status_code == 200:
            break
        time.sleep(3)
    assert last is not None
    assert last.status_code != 504, "Raw 504 leaked to client"
    # If 200, sanity-check payload
    if last.status_code == 200:
        d = last.json()
        assert "total_customers" in d


# --- SOR style_launch_dates hydration -------------------------------------
def test_sor_all_styles_launch_date_populated(client):
    last = None
    for _ in range(4):
        r = client.get(
            f"{BASE_URL}/api/analytics/sor-all-styles",
            params={"limit": 300},
            timeout=60,
        )
        last = r
        if r.status_code == 200:
            break
        time.sleep(4)
    assert last is not None and last.status_code == 200, (
        f"sor-all-styles failed: {last.status_code if last else 'no-resp'}"
    )
    payload = last.json()
    rows = payload if isinstance(payload, list) else payload.get("rows", [])
    assert len(rows) > 50, f"too few rows: {len(rows)}"
    with_launch = sum(1 for r in rows if r.get("launch_date"))
    pct = with_launch / len(rows) * 100
    # Mongo-backed cache should hydrate the vast majority of styles.
    assert pct >= 50.0, (
        f"only {pct:.1f}% rows have launch_date — Mongo cache hydration regression"
    )


# --- Footfall outside / turn-in (Iter 84h regression) ---------------------
def test_footfall_weekday_pattern_has_outside_and_turnin(client):
    r = client.get(
        f"{BASE_URL}/api/footfall/weekday-pattern",
        params={"date_from": "2025-11-01", "date_to": "2025-11-30"},
        timeout=30,
    )
    assert r.status_code == 200, r.text[:200]
    d = r.json()
    rows = d.get("rows", [])
    assert rows, "weekday-pattern returned no rows"
    sample = rows[0]
    for k in ("avg_outside_traffic", "avg_turn_in_rate", "total_outside_window"):
        assert k in sample, f"missing {k} in per-store row"
    ga = d.get("group_avg_by_weekday", [])
    assert ga, "group_avg_by_weekday missing"
    for k in ("avg_outside_traffic", "avg_turn_in_rate"):
        assert k in ga[0], f"missing {k} in group_avg"
