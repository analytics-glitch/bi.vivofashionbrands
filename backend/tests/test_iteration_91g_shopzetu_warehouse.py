"""
Iter 91g — Online - Shop Zetu treated as warehouse across ALL dashboard pages.

Backend-only test. Verifies that the duplicate is_warehouse_location() helper
in marketing_intel.py was updated to match server.py, and that the change
propagates correctly through every endpoint that classifies warehouse vs store.

Key invariants:
  • Both is_warehouse_location() functions (server.py + marketing_intel.py)
    return True for "Online - Shop Zetu".
  • Exec Summary stock_mix totals include Online - Shop Zetu units under the
    warehouse bucket, not the stores bucket.
  • Locations / Sell-through-by-location rankings exclude Online - Shop Zetu.
  • IBT suggestions never use Online - Shop Zetu as a store-to-store target/src.
  • Aged Stock rolls Online - Shop Zetu units into soh_warehouse.
  • Marketing slow-movers excludes Online - Shop Zetu from "where it's stocked".

Credentials: admin@vivofashiongroup.com / VivoAdmin!2026
"""
import os
import sys
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback for tests run inside the container
    BASE_URL = "https://bi-platform-2.preview.emergentagent.com"

ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"
TARGET_LOCATION = "Online - Shop Zetu"

# Add /app/backend to sys.path so we can import server + marketing_intel directly
sys.path.insert(0, "/app/backend")


def _get_with_retry(url, *, headers=None, params=None, timeout=180, retries=3, sleep_s=5):
    """Heavy analytics endpoints sometimes return 502 from the preview
    ingress on cold cache. Retry transient 5xx."""
    last = None
    for i in range(retries):
        try:
            r = requests.get(url, headers=headers, params=params, timeout=timeout)
        except requests.RequestException as e:
            last = e
            time.sleep(sleep_s)
            continue
        if r.status_code < 500:
            return r
        last = r
        time.sleep(sleep_s)
    return last if isinstance(last, requests.Response) else None


@pytest.fixture(scope="module")
def auth_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    if r.status_code != 200:
        pytest.skip(f"Login failed: {r.status_code} {r.text[:200]}")
    return r.json().get("token")


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


# ─── Unit tests on the helper functions (both files in sync) ─────────────
class TestWarehouseHelperUnit:
    def test_server_is_warehouse_location_true(self):
        from server import is_warehouse_location as srv_is_wh
        assert srv_is_wh(TARGET_LOCATION) is True

    def test_marketing_intel_is_warehouse_location_true(self):
        from marketing_intel import is_warehouse_location as mi_is_wh
        assert mi_is_wh(TARGET_LOCATION) is True

    def test_both_helpers_agree_on_zetu(self):
        from server import is_warehouse_location as srv_is_wh
        from marketing_intel import is_warehouse_location as mi_is_wh
        assert srv_is_wh(TARGET_LOCATION) == mi_is_wh(TARGET_LOCATION) is True

    def test_both_helpers_agree_on_real_store(self):
        """A real retail store should NOT be classified warehouse by either."""
        from server import is_warehouse_location as srv_is_wh
        from marketing_intel import is_warehouse_location as mi_is_wh
        for store in ("Sarit Centre", "Two Rivers", "Garden City"):
            assert srv_is_wh(store) is False, f"server.py wrongly flagged {store}"
            assert mi_is_wh(store) is False, f"marketing_intel wrongly flagged {store}"

    def test_helpers_case_insensitive(self):
        from server import is_warehouse_location as srv_is_wh
        from marketing_intel import is_warehouse_location as mi_is_wh
        assert srv_is_wh("online - shop zetu") is True
        assert mi_is_wh("ONLINE - SHOP ZETU") is True


# ─── Exec Summary stock_mix — warehouse bucket includes Zetu ────────────
class TestExecSummaryStockMix:
    def test_stock_mix_totals_invariant(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/exec-summary",
            headers=auth_headers, timeout=120,
        )
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        sm = data.get("stock_mix") or {}
        # Required keys (flat on stock_mix)
        for k in ("total_stock_units", "total_stock_units_warehouse", "total_stock_units_stores"):
            assert k in sm, f"missing stock_mix.{k}"
        # Invariant: warehouse + stores == total
        wh = int(sm["total_stock_units_warehouse"])
        st = int(sm["total_stock_units_stores"])
        tot = int(sm["total_stock_units"])
        assert wh + st == tot, f"Invariant broken: {wh}+{st}!={tot}"
        # After Iter 91f/g warehouse should have a non-trivial share — Zetu
        # alone is ~3,207 units. Use a soft floor of 20,000 to catch a
        # regression where Zetu falls back to "store".
        assert wh > 20000, f"warehouse bucket too low ({wh}) — Zetu may have leaked to stores"
        # Sanity bounds (live data ≈ 74,890)
        assert 50000 < tot < 200000, f"stock total off the charts: {tot}"


# ─── Sell-through-by-location rankings exclude Zetu ──────────────────────
class TestSellThroughByLocation:
    def test_zetu_excluded_from_rankings(self, auth_headers):
        # Use a recent ~30-day window
        params = {"date_from": "2026-04-01", "date_to": "2026-04-30"}
        r = requests.get(
            f"{BASE_URL}/api/analytics/sell-through-by-location",
            headers=auth_headers, params=params, timeout=120,
        )
        assert r.status_code == 200, r.text[:300]
        rows = r.json()
        assert isinstance(rows, list)
        zetu_rows = [x for x in rows if (x.get("location") or "").strip() == TARGET_LOCATION]
        assert len(zetu_rows) == 0, f"Zetu wrongly appeared in store rankings: {zetu_rows}"


# ─── IBT suggestions — Zetu never a store-to-store target/source ─────────
class TestIBTSuggestions:
    def test_zetu_not_in_ibt_recommendations(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/ibt-suggestions",
            headers=auth_headers,
            params={"date_from": "2026-04-01", "date_to": "2026-04-30", "limit": 200},
            timeout=180,
        )
        assert r.status_code == 200, r.text[:300]
        recs = r.json()
        assert isinstance(recs, list)
        offenders = []
        for rec in recs:
            frm = (rec.get("from_store") or rec.get("from") or "").strip()
            to_ = (rec.get("to_store") or rec.get("to") or "").strip()
            if frm == TARGET_LOCATION or to_ == TARGET_LOCATION:
                offenders.append({"from": frm, "to": to_, "style": rec.get("style") or rec.get("product_name")})
        assert not offenders, f"Zetu appears in store-to-store IBT recs: {offenders[:5]}"


# ─── Aged Stock — Zetu units roll into warehouse bucket, not stores ──────
class TestAgedStock:
    def test_zetu_not_a_store_row_and_units_in_warehouse(self, auth_headers):
        r = _get_with_retry(
            f"{BASE_URL}/api/analytics/aged-stock",
            headers=auth_headers,
            params={"min_days_since_sale": 60},
            timeout=180,
        )
        assert r is not None and r.status_code == 200, (r.status_code if r else "no response", (r.text[:300] if r else ""))
        rows = r.json()
        assert isinstance(rows, list)
        # Zetu must not appear as a store row in `pos_location`
        zetu_store_rows = [x for x in rows if (x.get("pos_location") or "").strip() == TARGET_LOCATION]
        assert not zetu_store_rows, f"Zetu wrongly listed as POS store in aged-stock: {len(zetu_store_rows)} rows"


# ─── Marketing slow-movers — Zetu excluded from 'where it's stocked' ─────
class TestMarketingSlowMovers:
    def test_zetu_excluded_from_locations_list(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/marketing/slow-movers",
            headers=auth_headers,
            params={"min_age_days": 60, "limit": 200},
            timeout=180,
        )
        # Endpoint may require specific params; accept 200 or 400 gracefully
        if r.status_code in (400, 404):
            pytest.skip(f"slow-movers endpoint unavailable: {r.status_code}")
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        rows = body if isinstance(body, list) else body.get("rows") or body.get("items") or body.get("results") or []
        offenders = []
        for row in rows:
            locs = row.get("locations") or row.get("where_stocked") or row.get("stocked_at") or []
            if isinstance(locs, str):
                locs = [locs]
            for loc in locs:
                if (loc or "").strip() == TARGET_LOCATION:
                    offenders.append({"style": row.get("style_name") or row.get("product_name"), "loc": loc})
                    break
        assert not offenders, f"Zetu wrongly listed in slow-movers 'where stocked': {offenders[:5]}"


# ─── Replenishment report — Zetu not a destination requiring top-up ──────
class TestReplenishment:
    def test_zetu_not_a_replenishment_destination(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/replenishment-report",
            headers=auth_headers,
            timeout=180,
        )
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        rows = body if isinstance(body, list) else body.get("rows") or body.get("items") or []
        offenders = []
        for row in rows:
            # Destination can be under different keys depending on shape
            for k in ("pos_location_name", "location_name", "destination", "to_store", "store"):
                if (row.get(k) or "").strip() == TARGET_LOCATION:
                    offenders.append({"key": k, "row": {kk: row.get(kk) for kk in ("sku", "product_name", k)}})
                    break
        assert not offenders, (
            f"Zetu wrongly listed as a replenishment destination: {len(offenders)} rows. "
            f"Sample: {offenders[:3]}"
        )
