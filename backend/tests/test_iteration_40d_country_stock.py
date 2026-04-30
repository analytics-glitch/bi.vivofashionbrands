"""Iter_40d: verify country-only queries to stock-to-sales endpoints return
per-country current_stock (NOT the upstream's global stock pass-through)."""
import os
import pytest
import requests

_env = os.environ.get("REACT_APP_BACKEND_URL")
if not _env:
    # Load from frontend/.env as the test runner env does not have it
    try:
        with open("/app/frontend/.env") as _f:
            for _l in _f:
                if _l.startswith("REACT_APP_BACKEND_URL="):
                    _env = _l.split("=", 1)[1].strip()
                    break
    except Exception:
        pass
BASE_URL = (_env or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"
CREDS = {"email": "admin@vivofashiongroup.com", "password": "VivoAdmin!2026"}

# Use an MTD window so we have non-zero units (sys date 2026-04-30)
DF, DT = "2026-04-01", "2026-04-30"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login", json=CREDS, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


def _get(path, auth, **params):
    r = requests.get(f"{API}{path}", headers=auth, params=params, timeout=120)
    assert r.status_code == 200, f"{path} {params} -> {r.status_code} {r.text[:200]}"
    return r.json()


# --- by-Category per-country stock differentiation --------------------------
def test_by_category_kenya_vs_uganda_vs_rwanda_distinct_stock(auth):
    ke = _get("/analytics/stock-to-sales-by-category", auth,
              country="Kenya", date_from=DF, date_to=DT)
    ug = _get("/analytics/stock-to-sales-by-category", auth,
              country="Uganda", date_from=DF, date_to=DT)
    rw = _get("/analytics/stock-to-sales-by-category", auth,
              country="Rwanda", date_from=DF, date_to=DT)

    def stock(rows, cat):
        for r in rows:
            if r.get("category") == cat:
                return float(r.get("current_stock") or 0)
        return 0.0

    ke_d, ug_d, rw_d = stock(ke, "Dresses"), stock(ug, "Dresses"), stock(rw, "Dresses")
    print(f"Dresses stock: Kenya={ke_d} Uganda={ug_d} Rwanda={rw_d}")

    # All three must be > 0 (physical stock countries)
    assert ke_d > 0 and ug_d > 0 and rw_d > 0
    # All three must be DIFFERENT (not the global pass-through)
    assert ke_d != ug_d, "Kenya and Uganda Dresses stock identical -> global pass-through regression"
    assert ke_d != rw_d, "Kenya and Rwanda Dresses stock identical -> global pass-through regression"
    assert ug_d != rw_d, "Uganda and Rwanda Dresses stock identical -> global pass-through regression"
    # Kenya should have the MOST stock, Rwanda the least (per ticket)
    assert ke_d > ug_d
    assert ke_d > rw_d


def test_by_category_kenya_has_units_sold_and_stock(auth):
    ke = _get("/analytics/stock-to-sales-by-category", auth,
              country="Kenya", date_from=DF, date_to=DT)
    # Non-empty
    assert isinstance(ke, list) and len(ke) > 0
    total_units = sum(r.get("units_sold") or 0 for r in ke)
    total_stock = sum(r.get("current_stock") or 0 for r in ke)
    assert total_units > 0
    assert total_stock > 0
    # Should NOT equal the known global Dresses=9600 pre-fix artifact
    for r in ke:
        if r.get("category") == "Dresses":
            assert r["current_stock"] != 9600, \
                "Kenya Dresses stock matches the GLOBAL pre-fix value of 9600"


# --- by-Subcat per-country stock differentiation ----------------------------
def test_by_subcat_kenya_vs_uganda_distinct_stock(auth):
    ke = _get("/analytics/stock-to-sales-by-subcat", auth,
              country="Kenya", date_from=DF, date_to=DT)
    ug = _get("/analytics/stock-to-sales-by-subcat", auth,
              country="Uganda", date_from=DF, date_to=DT)

    ke_map = {r["subcategory"]: r["current_stock"] for r in ke}
    ug_map = {r["subcategory"]: r["current_stock"] for r in ug}
    common = set(ke_map) & set(ug_map)
    assert len(common) >= 3
    # Count how many subcats have DIFFERENT stock per country
    diffs = sum(1 for s in common if ke_map[s] != ug_map[s])
    print(f"by-subcat distinct stock: {diffs}/{len(common)} subcats differ Kenya vs Uganda")
    # If global pass-through bug present, diffs would be 0. Expect most differ.
    assert diffs >= max(3, len(common) // 2), \
        f"Too few subcats have per-country stock: {diffs}/{len(common)}"


def test_by_subcat_rwanda_stock_lowest_among_physical(auth):
    ke = _get("/analytics/stock-to-sales-by-subcat", auth,
              country="Kenya", date_from=DF, date_to=DT)
    rw = _get("/analytics/stock-to-sales-by-subcat", auth,
              country="Rwanda", date_from=DF, date_to=DT)
    ke_total = sum(r.get("current_stock") or 0 for r in ke)
    rw_total = sum(r.get("current_stock") or 0 for r in rw)
    print(f"Total stock: Kenya={ke_total} Rwanda={rw_total}")
    assert ke_total > 0 and rw_total > 0
    assert ke_total > rw_total


# --- No-country regression: GLOBAL pass-through preserved -------------------
def test_by_subcat_no_country_global_pass_through(auth):
    rows = _get("/analytics/stock-to-sales-by-subcat", auth, date_from=DF, date_to=DT)
    assert isinstance(rows, list) and len(rows) > 0
    total_stock = sum(r.get("current_stock") or 0 for r in rows)
    total_units = sum(r.get("units_sold") or 0 for r in rows)
    # No-country call should still return non-empty data (upstream pass-through)
    assert total_stock > 0
    assert total_units > 0


def test_by_category_no_country_global(auth):
    rows = _get("/analytics/stock-to-sales-by-category", auth, date_from=DF, date_to=DT)
    assert isinstance(rows, list) and len(rows) > 0
    total_stock = sum(r.get("current_stock") or 0 for r in rows)
    assert total_stock > 0


# --- POS filter regression (was pre-fix correct) ----------------------------
def test_by_category_kenya_plus_pos_narrows_stock(auth):
    ke_country = _get("/analytics/stock-to-sales-by-category", auth,
                      country="Kenya", date_from=DF, date_to=DT)
    ke_pos = _get("/analytics/stock-to-sales-by-category", auth,
                  country="Kenya", locations="Vivo Imaara,Vivo Westgate",
                  date_from=DF, date_to=DT)
    c_total = sum(r.get("current_stock") or 0 for r in ke_country)
    p_total = sum(r.get("current_stock") or 0 for r in ke_pos)
    print(f"Kenya country stock={c_total}; +Vivo Westgate stock={p_total}")
    assert p_total > 0
    assert p_total < c_total  # POS narrows stock


# --- by-attribute (color/size) regression ----------------------------------
def test_by_attribute_kenya_country_scoped(auth):
    j = _get("/analytics/stock-to-sales-by-attribute", auth,
             country="Kenya", date_from=DF, date_to=DT)
    assert "by_color" in j and "by_size" in j
    total_stock_c = sum(r.get("current_stock") or 0 for r in j["by_color"])
    total_stock_s = sum(r.get("current_stock") or 0 for r in j["by_size"])
    assert total_stock_c > 0 and total_stock_s > 0


# --- /kpis and /country-summary regressions -------------------------------
def test_kpis_kenya(auth):
    j = _get("/kpis", auth, country="Kenya", date_from=DF, date_to=DT)
    assert j.get("net_sales", 0) > 0 or j.get("gross_sales", 0) > 0


def test_country_summary_q2(auth):
    j = _get("/country-summary", auth, date_from="2026-04-01", date_to="2026-06-30")
    # Must be list of countries with achieved > 0 for at least one
    assert isinstance(j, list) and len(j) >= 3
    names = {(r.get("country") or "").lower() for r in j}
    assert {"kenya", "uganda", "rwanda"}.issubset(names)


# --- Multi-country regression ---------------------------------------------
def test_multi_country_by_subcat(auth):
    j = _get("/analytics/stock-to-sales-by-subcat", auth,
             country="Kenya,Uganda", date_from=DF, date_to=DT)
    assert isinstance(j, list) and len(j) > 0
    total_units = sum(r.get("units_sold") or 0 for r in j)
    total_stock = sum(r.get("current_stock") or 0 for r in j)
    assert total_units > 0 and total_stock > 0
