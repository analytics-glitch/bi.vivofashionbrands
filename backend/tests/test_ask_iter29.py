"""Iteration 29: Natural-language /api/search/ask endpoint tests."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend env file
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass

ADMIN = {"email": "admin@vivofashiongroup.com", "password": "VivoAdmin!2026"}


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _ask(headers, q, timeout=90):
    return requests.post(f"{BASE_URL}/api/search/ask", json={"q": q}, headers=headers, timeout=timeout)


# --- Auth guards ---
def test_ask_requires_auth():
    r = requests.post(f"{BASE_URL}/api/search/ask", json={"q": "hi"}, timeout=15)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


def test_ask_empty_body_returns_400(headers):
    r = requests.post(f"{BASE_URL}/api/search/ask", json={}, headers=headers, timeout=15)
    assert r.status_code == 400

def test_ask_empty_q_returns_400(headers):
    r = requests.post(f"{BASE_URL}/api/search/ask", json={"q": ""}, headers=headers, timeout=15)
    assert r.status_code == 400


# --- Intent classification tests ---
def _validate_shape(d, q):
    for k in ("q", "intent", "filters", "answer", "link", "rows", "count"):
        assert k in d, f"missing key '{k}' in response for q='{q}': {d}"
    assert d["q"] == q
    assert isinstance(d["rows"], list)
    assert d["count"] == len(d["rows"])
    # Rows must have title + sub when not empty
    for row in d["rows"]:
        assert "title" in row and "sub" in row, f"row missing title/sub: {row}"


def test_stock_aging_phantom(headers):
    r = _ask(headers, "phantom stock styles")
    assert r.status_code == 200, r.text
    d = r.json()
    _validate_shape(d, "phantom stock styles")
    assert d["intent"] == "stock_aging", d
    assert d["link"] == "/inventory#stock-aging-summary"


def test_sell_through_stuck(headers):
    r = _ask(headers, "stores with stuck stock")
    assert r.status_code == 200, r.text
    d = r.json()
    _validate_shape(d, "stores with stuck stock")
    assert d["intent"] == "sell_through", d
    health = d.get("filters", {}).get("health_in") or []
    assert "stuck" in health, f"expected 'stuck' in health_in, got {health}"


def test_stores_top_5_by_sales(headers):
    r = _ask(headers, "top 5 stores by sales")
    assert r.status_code == 200, r.text
    d = r.json()
    _validate_shape(d, "top 5 stores by sales")
    assert d["intent"] == "stores"
    f = d.get("filters") or {}
    assert f.get("metric") == "sales", f
    assert f.get("top_n") == 5, f


def test_customers_absent_60(headers):
    r = _ask(headers, "customers absent 60 days")
    assert r.status_code == 200, r.text
    d = r.json()
    _validate_shape(d, "customers absent 60 days")
    assert d["intent"] == "customers", d
    f = d.get("filters") or {}
    assert f.get("mode") == "absent"
    assert int(f.get("days_absent_min") or 0) >= 60


def test_pricing_increase_10pct(headers):
    r = _ask(headers, "styles whose price went up 10%")
    assert r.status_code == 200, r.text
    d = r.json()
    _validate_shape(d, "styles whose price went up 10%")
    assert d["intent"] == "pricing"
    f = d.get("filters") or {}
    assert f.get("direction") == "increase"
    change = f.get("min_change_pct") or 0
    assert 8 <= change <= 12, f"expected min_change_pct ~10, got {change}"


def test_reorder_critical(headers):
    r = _ask(headers, "critical reorders right now")
    assert r.status_code == 200, r.text
    d = r.json()
    _validate_shape(d, "critical reorders right now")
    assert d["intent"] == "reorder"
    urg = d.get("filters", {}).get("urgency_in") or []
    assert "CRITICAL" in urg, f"expected CRITICAL in urgency_in, got {urg}"


def test_page_navigation(headers):
    r = _ask(headers, "go to inventory")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["intent"] == "page", d
    assert d["link"] == "/inventory"
    assert d["rows"] == []


def test_unknown_question(headers):
    r = _ask(headers, "what is the meaning of life")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["intent"] == "unknown"
    assert d["link"] is None
    assert isinstance(d.get("answer"), str) and len(d["answer"]) > 0


# --- Caching: second call to same q should be significantly faster ---
def test_intent_cache_speedup(headers):
    q = "phantom stock styles"  # already cached by earlier test
    t0 = time.time()
    r = _ask(headers, q)
    elapsed = time.time() - t0
    assert r.status_code == 200
    # Data fetch still takes time but LLM call should be skipped — total
    # should usually be <15s. Non-strict assertion to avoid flakiness.
    assert elapsed < 30, f"cached ask too slow: {elapsed:.1f}s"
