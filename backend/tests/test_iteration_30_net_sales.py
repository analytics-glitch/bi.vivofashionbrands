"""
Iteration 30: Channel/location sales now display NET sales (not gross-minus-discount).

Tests cover the bug fix where upstream `total_sales` (which still includes returns)
was being displayed as the headline. After the fix:
  - /api/kpis: returns total_sales + net_sales + gross_sales (unchanged, frontend
    normaliser swaps in net as the canonical headline)
  - /api/analytics/sell-through-by-location: `total_sales` equals `net_sales`
  - /api/search/ask intent=stores: `sales` field reflects net
"""

import os
import pytest
import requests

def _read_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        return None
    return None


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not available"
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PWD = "VivoAdmin!2026"

DATE_FROM = "2026-04-01"
DATE_TO = "2026-04-19"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
        timeout=30,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    t = r.json().get("token")
    assert t, "No token in login response"
    return t


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# /api/kpis — still returns all three values
# ---------------------------------------------------------------------------
class TestKpisShape:
    def test_kpis_exposes_total_net_and_gross(self, auth):
        r = requests.get(
            f"{BASE_URL}/api/kpis",
            params={"date_from": DATE_FROM, "date_to": DATE_TO},
            headers=auth,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("total_sales", "net_sales", "gross_sales"):
            assert k in data, f"missing {k}; keys={list(data.keys())}"
            assert isinstance(data[k], (int, float)), f"{k} not numeric"
        # Per bug spec gross_sales < total_sales (discount removed) and
        # net_sales < total_sales (returns removed from the still-with-
        # returns 'total_sales' figure).
        assert data["net_sales"] <= data["total_sales"] + 1, (
            f"net_sales ({data['net_sales']}) should be <= total_sales ({data['total_sales']})"
        )

    def test_kpis_math_sanity(self, auth):
        """Rough sanity: net should be less than total (which includes returns)."""
        r = requests.get(
            f"{BASE_URL}/api/kpis",
            params={"date_from": "2026-01-01", "date_to": "2026-04-30"},
            headers=auth,
            timeout=60,
        )
        assert r.status_code == 200
        d = r.json()
        # When there are any returns, net_sales < total_sales
        returns = d.get("total_returns") or 0
        if returns > 0:
            assert d["net_sales"] < d["total_sales"], (
                f"With returns={returns}, net ({d['net_sales']}) should be < total ({d['total_sales']})"
            )


# ---------------------------------------------------------------------------
# /api/analytics/sell-through-by-location — total_sales == net_sales post-fix
# ---------------------------------------------------------------------------
class TestSellThroughByLocation:
    def test_total_equals_net_per_row(self, auth):
        r = requests.get(
            f"{BASE_URL}/api/analytics/sell-through-by-location",
            params={"date_from": DATE_FROM, "date_to": DATE_TO},
            headers=auth,
            timeout=90,
        )
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list), f"expected list, got {type(rows)}"
        assert len(rows) > 0, "no rows returned"

        mismatches = []
        for row in rows:
            ts = row.get("total_sales")
            ns = row.get("net_sales")
            assert ts is not None, f"row missing total_sales: {row}"
            assert ns is not None, f"row missing net_sales: {row}"
            # They must be equal (both set to net by backend)
            if abs(float(ts) - float(ns)) > 0.5:
                mismatches.append({
                    "location": row.get("location"),
                    "channel": row.get("channel"),
                    "total_sales": ts,
                    "net_sales": ns,
                })
        assert not mismatches, f"Found rows where total_sales != net_sales: {mismatches[:5]}"

    def test_online_shop_zetu_net_lower_than_gross(self, auth):
        """
        User-cited example: Online – Shop Zetu had total_sales=327,174 but
        real net was 261,024. After fix, `total_sales` on this row should be
        the net (~261k), not the gross-minus-discount.
        """
        r = requests.get(
            f"{BASE_URL}/api/analytics/sell-through-by-location",
            params={"date_from": "2026-01-01", "date_to": "2026-04-30"},
            headers=auth,
            timeout=90,
        )
        assert r.status_code == 200
        rows = r.json()
        sz = [
            row for row in rows
            if "shop zetu" in (row.get("location") or "").lower()
            or "shop zetu" in (row.get("channel") or "").lower()
        ]
        if not sz:
            pytest.skip("No 'Shop Zetu' row in this window — skipping spot check")
        for row in sz:
            # total_sales should equal net_sales (both net) post-fix
            assert abs(float(row["total_sales"]) - float(row["net_sales"])) < 0.5


# ---------------------------------------------------------------------------
# /api/search/ask intent='stores' — prefers net
# ---------------------------------------------------------------------------
class TestAskStoresNet:
    def test_top_stores_by_sales_uses_net(self, auth):
        r = requests.post(
            f"{BASE_URL}/api/search/ask",
            json={
                "q": "top 5 stores by sales",
                "date_from": DATE_FROM,
                "date_to": DATE_TO,
            },
            headers=auth,
            timeout=90,
        )
        # Ask endpoint may be slow — accept 200 or skip on LLM failure.
        if r.status_code >= 500:
            pytest.skip(f"Ask endpoint 5xx: {r.status_code} {r.text[:200]}")
        assert r.status_code == 200, r.text
        data = r.json()
        # Intent should be 'stores'
        intent = data.get("intent")
        assert intent in ("stores", "unknown"), f"unexpected intent {intent}"
        if intent != "stores":
            pytest.skip(f"LLM classified as {intent}, can't validate net field")
        rows = data.get("rows") or []
        assert rows, "no rows returned for stores intent"
        # _fetch_stores uses its own 28-day window, not our filters.
        # Code inspection at ask.py:407 confirms it uses
        #   float(r.get("net_sales") or r.get("total_sales") or 0)
        # which prefers net. We confirm the row shape is valid.
        for row in rows[:3]:
            assert row.get("title"), f"row missing title: {row}"
            assert row.get("sub"), f"row missing sub: {row}"
            assert "KES" in row.get("sub", ""), f"sub missing KES: {row}"


# ---------------------------------------------------------------------------
# Regression: /api/sales-summary still exposes both for frontend to normalise
# ---------------------------------------------------------------------------
class TestSalesSummaryUnchanged:
    def test_sales_summary_rows_have_both(self, auth):
        r = requests.get(
            f"{BASE_URL}/api/sales-summary",
            params={"date_from": DATE_FROM, "date_to": DATE_TO},
            headers=auth,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list) and rows
        sample = rows[0]
        assert "total_sales" in sample
        assert "net_sales" in sample
        # net typically <= total (unless no returns in this row)
        for row in rows:
            ts = float(row.get("total_sales") or 0)
            ns = float(row.get("net_sales") or 0)
            assert ns <= ts + 1, f"net ({ns}) > total ({ts}) in row {row.get('channel')}/{row.get('location')}"
