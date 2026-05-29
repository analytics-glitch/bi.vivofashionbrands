"""Backend tests for Marketing Intelligence + retired-styles inventory toggle (iter 89/90)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to frontend/.env directly if not exported
    try:
        with open("/app/frontend/.env") as f:
            for ln in f:
                if ln.startswith("REACT_APP_BACKEND_URL"):
                    BASE_URL = ln.split("=", 1)[1].strip().strip('"').rstrip("/")
                    break
    except Exception:
        pass

ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASS = "VivoAdmin!2026"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=90,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def hdr(token):
    return {"Authorization": f"Bearer {token}"}


# ---- /api/inventory-style-counts ----
def test_inventory_style_counts(hdr):
    r = requests.get(f"{BASE_URL}/api/inventory-style-counts", headers=hdr, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("active_styles", "retired_styles", "active_units", "retired_units", "total_styles", "total_units"):
        assert k in d, f"missing {k}: {d}"
    assert d["active_styles"] > 0
    assert d["retired_styles"] > 0
    assert d["active_styles"] + d["retired_styles"] == d["total_styles"]
    assert d["active_units"] + d["retired_units"] == d["total_units"]


# ---- /api/inventory style_status toggle ----
@pytest.mark.parametrize("status", ["active", "retired", "all"])
def test_inventory_style_status_filter(hdr, status):
    r = requests.get(
        f"{BASE_URL}/api/inventory",
        headers=hdr,
        params={"style_status": status, "limit": 200},
        timeout=120,
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = payload.get("rows") or payload.get("data") or []
    else:
        rows = []
    assert isinstance(rows, list)
    if rows:
        sample = rows[0]
        assert "style_status" in sample, f"row missing style_status: {sample.keys()}"
        # retired_at must exist as a key (null for active)
        assert "retired_at" in sample, f"row missing retired_at: {sample.keys()}"
        if status == "retired":
            for row in rows[:20]:
                assert row.get("style_status") == "retired"
                assert row.get("retired_at") is not None
        if status == "active":
            for row in rows[:20]:
                assert row.get("style_status") == "active"


# ---- /api/marketing/slow-movers ----
def test_marketing_slow_movers_shape(hdr):
    r = requests.get(f"{BASE_URL}/api/marketing/slow-movers", headers=hdr, timeout=180)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "window" in d and "threshold" in d and "summary" in d and "rows" in d
    for k in ("total_slow_movers", "stock_value_at_risk_kes", "avg_sor_percent",
              "critical_count", "improving_count", "new_today"):
        assert k in d["summary"], f"summary missing {k}"
    assert d["threshold"] == 40.0
    assert isinstance(d["rows"], list) and len(d["rows"]) > 0
    row = d["rows"][0]
    for k in ("style_name", "brand", "subcategory", "category", "current_stock",
              "units_sold", "sor_percent", "locations", "flagged_date",
              "days_since_flagged", "status", "action_status", "notes",
              "suggested_action"):
        assert k in row, f"row missing {k}: {list(row.keys())}"
    assert row["sor_percent"] < 40
    assert row["status"] in {"New", "Monitored", "Improving", "Critical"}
    assert row["action_status"] in {"pending", "in_progress", "done"}


# ---- /api/marketing/heatmap ----
def test_marketing_heatmap_shape(hdr):
    r = requests.get(f"{BASE_URL}/api/marketing/heatmap", headers=hdr, timeout=180)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "locations" in d and "categories" in d and "cells" in d
    expected = {"Tops", "Bottoms", "Dresses", "Skirts", "Outerwear", "Two-Piece Sets", "Mens"}
    assert set(d["categories"]) == expected
    assert len(d["locations"]) > 0
    first_loc = d["locations"][0]
    cell_row = d["cells"][first_loc]
    for cat in d["categories"]:
        c = cell_row[cat]
        assert "units_sold" in c and "current_stock" in c and "sor_percent" in c


# ---- /api/marketing/flags filter ----
def test_marketing_flags_list_and_filter(hdr):
    r = requests.get(f"{BASE_URL}/api/marketing/flags", headers=hdr, timeout=60)
    assert r.status_code == 200
    d = r.json()
    assert "count" in d and "rows" in d
    # filter
    r2 = requests.get(f"{BASE_URL}/api/marketing/flags",
                      headers=hdr, params={"action_status": "done"}, timeout=60)
    assert r2.status_code == 200
    for row in r2.json()["rows"]:
        assert row.get("action_status") == "done"


# ---- PATCH /api/marketing/flags/{style_name} ----
def test_patch_marketing_flag_validation_and_update(hdr):
    # First grab a style_name from slow-movers
    r = requests.get(f"{BASE_URL}/api/marketing/slow-movers", headers=hdr, timeout=180)
    style = r.json()["rows"][0]["style_name"]

    # 400 when empty body
    r = requests.patch(f"{BASE_URL}/api/marketing/flags/{style}", json={}, headers=hdr, timeout=30)
    assert r.status_code == 400, r.text

    # 400 when bad action_status
    r = requests.patch(f"{BASE_URL}/api/marketing/flags/{style}",
                       json={"action_status": "bogus"}, headers=hdr, timeout=30)
    assert r.status_code == 400, r.text

    # Successful update
    r = requests.patch(f"{BASE_URL}/api/marketing/flags/{style}",
                       json={"action_status": "in_progress", "notes": "TEST_iter89 note"},
                       headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["action_status"] == "in_progress"
    assert d["notes"] == "TEST_iter89 note"
    assert d.get("updated_by") == ADMIN_EMAIL


# ---- POST /api/marketing/flags/bulk-status ----
def test_bulk_status_update(hdr):
    r = requests.get(f"{BASE_URL}/api/marketing/slow-movers", headers=hdr, timeout=180)
    styles = [r.json()["rows"][i]["style_name"] for i in range(min(3, len(r.json()["rows"])))]
    r = requests.post(f"{BASE_URL}/api/marketing/flags/bulk-status",
                      json={"style_names": styles, "action_status": "in_progress"},
                      headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "updated" in d
    assert d["updated"] >= 0

    # reject bad status
    r = requests.post(f"{BASE_URL}/api/marketing/flags/bulk-status",
                      json={"style_names": styles, "action_status": "WRONG"},
                      headers=hdr, timeout=30)
    assert r.status_code == 400


# ---- Auto-flagging idempotency ----
def test_auto_flag_no_duplicates(hdr):
    r1 = requests.get(f"{BASE_URL}/api/marketing/slow-movers", headers=hdr, timeout=180)
    n1 = r1.json()["summary"]["total_slow_movers"]
    r2 = requests.get(f"{BASE_URL}/api/marketing/flags", headers=hdr,
                      params={"limit": 10000}, timeout=60)
    n2 = r2.json()["count"]
    # Second call - count should not blow up
    requests.get(f"{BASE_URL}/api/marketing/slow-movers", headers=hdr, timeout=180)
    r3 = requests.get(f"{BASE_URL}/api/marketing/flags", headers=hdr,
                      params={"limit": 10000}, timeout=60)
    n3 = r3.json()["count"]
    # Idempotency — flag count should not grow on repeat calls.
    assert n3 == n2, f"duplicate flags inserted: before={n2}, after={n3}"
    # Persistence — flags should be roughly equal to current slow movers
    # (allow small drift since accessories/retired styles can be filtered.)
    assert n2 >= n1 * 0.95, f"flag persistence broken: flags={n2}, slow={n1}"
