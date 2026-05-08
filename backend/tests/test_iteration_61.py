"""Iter-61 backend regression — focused on the four user-requested deltas:
  1. Allocations: WH% → Online% → Stores priority, multi-criteria weights
  2. IBT flat tables: days_lapsed + first_seen_at enrichment
  3. Monthly Targets: asp / basket_kes / orders_per_day on stores +
     suggested_daily_quantity / suggested_basket_size on future days
  4. IBT SKU breakdown: barcode global fallback (regression from iter-60)
Plus a smoke regression on key endpoints.
"""
import os
import datetime as dt

import pytest
import requests

def _read_frontend_env():
    """Frontend .env is the source of truth for the public URL."""
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    return None


BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env() or ""
).rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASS = "VivoAdmin!2026"


# ── Fixtures ──────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_token(session):
    r = session.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=30,
    )
    if r.status_code != 200:
        pytest.skip(f"admin login failed: {r.status_code} {r.text[:300]}")
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="session")
def auth(session, admin_token):
    session.headers.update({"Authorization": f"Bearer {admin_token}"})
    return session


# ── 1. Allocations ────────────────────────────────────────────────────
def _alloc_payload(**over):
    today = dt.date.today()
    base = {
        "subcategory": "Maxi Dresses",
        "color": None,
        "sizes": ["XS", "S", "M", "L"],
        "units_total": 400,
        "date_from": (today - dt.timedelta(days=180)).isoformat(),
        "date_to": today.isoformat(),
        "velocity_weight": 0.5,
        "stock_weight": 0.3,
        "asp_weight": 0.2,
        "warehouse_pct": 10.0,
        "online_pct": 5.0,
        "excluded_stores": [],
        "allocation_type": "new",
    }
    base.update(over)
    return base


class TestAllocationsCalculate:
    def test_calculate_returns_warehouse_online_store_split(self, auth):
        # Retry once on 502 (preview cold-start)
        for attempt in range(2):
            r = auth.post(
                f"{BASE_URL}/api/allocations/calculate",
                json=_alloc_payload(warehouse_pct=10, online_pct=5),
                timeout=120,
            )
            if r.status_code != 502:
                break
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        # Required new top-level fields
        for k in ("warehouse_units", "online_units", "store_units",
                  "pack_unit_size", "rows", "available_packs",
                  "allocated_units"):
            assert k in d, f"missing key: {k}"
        units_total = d["allocated_units"]
        # 10/5/85 expected approximation
        assert d["warehouse_units"] >= 0
        assert d["online_units"] >= 0
        assert d["store_units"] >= 0
        # Ratios should be roughly correct (within pack-rounding tolerance)
        wh_ratio = d["warehouse_units"] / max(units_total, 1)
        on_ratio = d["online_units"] / max(units_total, 1)
        assert 0.05 <= wh_ratio <= 0.15, (
            f"warehouse_units ratio {wh_ratio:.3f} not ~10%"
        )
        assert 0.02 <= on_ratio <= 0.10, (
            f"online_units ratio {on_ratio:.3f} not ~5%"
        )
        # Sum identity
        assert (
            d["warehouse_units"] + d["online_units"] + d["store_units"]
            == d["allocated_units"]
        )

    def test_rows_carry_channel_asp_score_asp_kes(self, auth):
        r = auth.post(
            f"{BASE_URL}/api/allocations/calculate",
            json=_alloc_payload(warehouse_pct=10, online_pct=5),
            timeout=60,
        )
        assert r.status_code == 200
        rows = r.json()["rows"]
        assert len(rows) > 0
        for row in rows:
            assert row["channel"] in {"warehouse", "online", "store"}
            assert "asp_score" in row
            assert "asp_kes" in row
            assert isinstance(row["asp_score"], (int, float))
            assert isinstance(row["asp_kes"], (int, float))
        # Warehouse and Online rows must appear at the TOP
        channels_in_order = [r["channel"] for r in rows]
        # find first 'store' index — anything before must be wh/online
        first_store = next(
            (i for i, c in enumerate(channels_in_order) if c == "store"),
            len(channels_in_order),
        )
        for c in channels_in_order[:first_store]:
            assert c in {"warehouse", "online"}, (
                f"non wh/online row appeared before stores: {channels_in_order}"
            )

    def test_zero_weights_falls_back_no_500(self, auth):
        r = auth.post(
            f"{BASE_URL}/api/allocations/calculate",
            json=_alloc_payload(
                velocity_weight=0, stock_weight=0, asp_weight=0,
                warehouse_pct=0, online_pct=0,
            ),
            timeout=60,
        )
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        # all-zero weights → even split fallback; allocation should still
        # produce store rows
        assert d["store_units"] > 0
        assert any(r["channel"] == "store" for r in d["rows"])

    def test_default_weights_no_wh_no_online(self, auth):
        # Defaults from request: 0/0% reservations.
        r = auth.post(
            f"{BASE_URL}/api/allocations/calculate",
            json=_alloc_payload(warehouse_pct=0, online_pct=0),
            timeout=60,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["warehouse_units"] == 0
        assert d["online_units"] == 0
        assert d["store_units"] == d["allocated_units"]

    def test_unbalanced_weights_renormalised(self, auth):
        # Sliders not summing to 1 should still work
        r = auth.post(
            f"{BASE_URL}/api/allocations/calculate",
            json=_alloc_payload(
                velocity_weight=0.9, stock_weight=0.8, asp_weight=0.7,
            ),
            timeout=60,
        )
        assert r.status_code == 200, r.text[:300]


class TestAllocationsSave:
    def test_save_accepts_new_optional_fields(self, auth):
        # Build save payload using calculate output as template.
        cr = auth.post(
            f"{BASE_URL}/api/allocations/calculate",
            json=_alloc_payload(warehouse_pct=10, online_pct=5),
            timeout=60,
        )
        assert cr.status_code == 200
        c = cr.json()
        save_payload = {
            "subcategory": "Maxi Dresses",
            "style_name": f"TEST_iter61_{dt.datetime.utcnow().timestamp():.0f}",
            "color": None,
            "sizes": ["XS", "S", "M", "L"],
            "units_total": c["allocated_units"],
            "date_from": (dt.date.today() - dt.timedelta(days=180)).isoformat(),
            "date_to": dt.date.today().isoformat(),
            "velocity_weight": 0.5,
            "stock_weight": 0.3,
            "asp_weight": 0.2,
            "warehouse_pct": 10.0,
            "online_pct": 5.0,
            "excluded_stores": [],
            "allocation_type": "new",
            "pack_unit_size": c["pack_unit_size"],
            "pack_breakdown": c["pack_breakdown"],
            "rows": c["rows"],
        }
        r = auth.post(
            f"{BASE_URL}/api/allocations/save", json=save_payload, timeout=30,
        )
        assert r.status_code in (200, 201), r.text[:400]
        d = r.json()
        assert "id" in d
        assert "_id" not in d


# ── 2. IBT enrichment ────────────────────────────────────────────────
class TestIBTEnrichment:
    def test_ibt_suggestions_has_days_lapsed_and_first_seen_at(self, auth):
        r = auth.get(
            f"{BASE_URL}/api/analytics/ibt-suggestions", timeout=120,
        )
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        rows = data if isinstance(data, list) else data.get("rows", data.get("suggestions", []))
        if not rows:
            pytest.skip("no ibt-suggestions rows to validate")
        for row in rows[:20]:
            assert "days_lapsed" in row
            assert "first_seen_at" in row
            assert isinstance(row["days_lapsed"], int)
            assert row["days_lapsed"] >= 0

    def test_ibt_warehouse_to_store_has_days_lapsed(self, auth):
        r = auth.get(
            f"{BASE_URL}/api/analytics/ibt-warehouse-to-store", timeout=120,
        )
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        rows = data if isinstance(data, list) else data.get("rows", data.get("suggestions", []))
        if not rows:
            pytest.skip("no warehouse-to-store rows to validate")
        for row in rows[:20]:
            assert "days_lapsed" in row
            assert "first_seen_at" in row
            assert isinstance(row["days_lapsed"], int)


# ── 3. Monthly targets enrichment ────────────────────────────────────
class TestMonthlyTargets:
    def test_monthly_targets_per_store_pace_metrics(self, auth):
        month = dt.date.today().strftime("%Y-%m-01")
        r = auth.get(
            f"{BASE_URL}/api/analytics/monthly-targets",
            params={"month": month}, timeout=180,
        )
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        stores = data.get("stores") or data.get("rows") or []
        if not stores:
            pytest.skip("monthly-targets returned no stores")
        # Find a store with data — check at least one carries asp/basket
        for s in stores:
            if "asp" in s and "basket_kes" in s and "orders_per_day" in s:
                # types should be numbers
                assert isinstance(s["asp"], (int, float))
                assert isinstance(s["basket_kes"], (int, float))
                assert isinstance(s["orders_per_day"], (int, float))
                break
        else:
            pytest.fail(
                "no store carried asp/basket_kes/orders_per_day fields"
            )

    def test_monthly_targets_future_rows_have_suggested_qty_and_basket(self, auth):
        month = dt.date.today().strftime("%Y-%m-01")
        r = auth.get(
            f"{BASE_URL}/api/analytics/monthly-targets",
            params={"month": month}, timeout=180,
        )
        assert r.status_code == 200
        data = r.json()
        stores = data.get("stores") or data.get("rows") or []
        if not stores:
            pytest.skip("no stores")
        today_iso = dt.date.today().isoformat()
        future_seen, past_seen = False, False
        for s in stores:
            days = s.get("days") or s.get("daily") or s.get("breakdown") or []
            if not days:
                continue
            for d in days:
                day_str = d.get("date") or d.get("day") or ""
                # Past/today row → suggested_* should be None (or absent
                # for very old rows — treat absent as null).
                if day_str and day_str <= today_iso:
                    if "suggested_daily_quantity" in d:
                        assert d["suggested_daily_quantity"] is None
                    if "suggested_basket_size" in d:
                        assert d["suggested_basket_size"] is None
                    past_seen = True
                # Future row → keys must exist; values may be int/float
                # OR null (when channel pace is 0).
                elif day_str and day_str > today_iso:
                    assert "suggested_daily_quantity" in d, d
                    assert "suggested_basket_size" in d, d
                    sdq = d["suggested_daily_quantity"]
                    sbs = d["suggested_basket_size"]
                    assert sdq is None or isinstance(sdq, int)
                    assert sbs is None or isinstance(sbs, (int, float))
                    future_seen = True
            if future_seen and past_seen:
                return
        # Even if we only saw one of past/future, that's still informative
        assert future_seen or past_seen, "no daily breakdown rows found"


# ── 4. IBT SKU breakdown barcode fallback ────────────────────────────
class TestIBTSkuBreakdown:
    def test_barcode_populated_for_meru_to_sarit_poncho(self, auth):
        params = {
            "style_name": "Vivo Basic Double Layered Wrap Poncho",
            "from_store": "Vivo Meru",
            "to_store": "Vivo Sarit",
        }
        r = auth.get(
            f"{BASE_URL}/api/analytics/ibt-sku-breakdown",
            params=params, timeout=60,
        )
        if r.status_code == 404:
            pytest.skip("style/from/to combo unavailable in this dataset")
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        rows = data.get("skus") or (data if isinstance(data, list) else data.get("rows", []))
        if not rows:
            pytest.skip("no rows for poncho Meru→Sarit")
        with_barcode = [r for r in rows if r.get("barcode")]
        assert with_barcode, "all rows missing barcode — fallback not working"
        # Iter-60 said barcode global fallback should populate ALL rows
        assert len(with_barcode) == len(rows), (
            f"only {len(with_barcode)}/{len(rows)} rows had barcode — "
            "global fallback regressed"
        )


# ── 5. Smoke regression ──────────────────────────────────────────────
SMOKE_ENDPOINTS = [
    "/api/auth/me",
    "/api/kpis",
    "/api/sales-summary",
    "/api/inventory",
    "/api/footfall",
    "/api/analytics/ibt-suggestions",
    "/api/analytics/sor-all-styles",
]


@pytest.mark.parametrize("path", SMOKE_ENDPOINTS)
def test_smoke_endpoints_200(auth, path):
    r = auth.get(f"{BASE_URL}{path}", timeout=180)
    assert r.status_code == 200, f"{path} → {r.status_code} {r.text[:200]}"


def test_smoke_monthly_targets_with_month(auth):
    month = dt.date.today().strftime("%Y-%m-01")
    r = auth.get(
        f"{BASE_URL}/api/analytics/monthly-targets",
        params={"month": month}, timeout=180,
    )
    assert r.status_code == 200, r.text[:200]
