"""Iter 78 — Full self-audit script.

Measures cold + cached latency for EVERY page's primary endpoint(s).
Run from /app: python backend/tests/audit_full_self.py
"""
import os
import time
import json
import requests
from concurrent.futures import ThreadPoolExecutor

BASE_URL = os.environ.get("BASE_URL", "https://bi-platform-2.preview.emergentagent.com")
EMAIL = "admin@vivofashiongroup.com"
PW = "VivoAdmin!2026"

# Page → primary endpoints (the ones that gate first paint).
# Each entry is (page_name, [(label, endpoint_path), ...])
PAGES = [
    ("Overview",            [("kpis",            "/api/kpis"),
                             ("daily-trend",     "/api/daily-trend"),
                             ("country-summary", "/api/country-summary"),
                             ("footfall",        "/api/footfall")]),
    ("Sales Summary",       [("sales-summary",   "/api/sales-summary?date_from=2026-04-16&date_to=2026-05-14")]),
    ("Locations",           [("sales-summary",   "/api/sales-summary?date_from=2026-04-16&date_to=2026-05-14"),
                             ("stock-to-sales",  "/api/analytics/stock-to-sales-by-subcategory?date_from=2026-04-16&date_to=2026-05-14"),
                             ("weekday-pattern", "/api/footfall/weekday-pattern?date_from=2026-04-16&date_to=2026-05-14")]),
    ("Stock to Sales",      [("stock-to-sales",  "/api/analytics/stock-to-sales-by-subcategory?date_from=2026-04-16&date_to=2026-05-14")]),
    ("Replenishments",      [("replenishment-report", "/api/analytics/replenishment-report")]),
    ("IBT (Store→Store)",   [("ibt-suggestions", "/api/analytics/ibt-suggestions?date_from=2026-04-16&date_to=2026-05-14")]),
    ("IBT (Warehouse)",     [("ibt-warehouse",   "/api/analytics/ibt-warehouse-to-store?country=Kenya")]),
    ("Allocations",         [("alloc-stores",    "/api/allocations/stores")]),
    ("SOR",                 [("sor",             "/api/sor?date_from=2026-04-16&date_to=2026-05-14&limit=5000")]),
    ("Customers",           [("customers",       "/api/customers?date_from=2026-04-16&date_to=2026-05-14&limit=200")]),
    ("Footfall",            [("footfall",        "/api/footfall?date_from=2026-04-16&date_to=2026-05-14"),
                             ("weekday-pattern", "/api/footfall/weekday-pattern?date_from=2026-04-16&date_to=2026-05-14")]),
    ("Targets",             [("targets",         "/api/analytics/targets-quarterly")]),
    ("Completed Moves",     [("ibt-completed",   "/api/ibt/completed")]),
    ("Products",            [("top-skus",        "/api/top-skus?date_from=2026-04-16&date_to=2026-05-14&limit=200")]),
    ("Re-Order (L-10)",     [("low-10",          "/api/analytics/low-10?date_from=2026-04-16&date_to=2026-05-14")]),
    ("Customer Details",    [("churn-customers", "/api/customers/churn-risk?date_from=2026-04-16&date_to=2026-05-14&limit=100")]),
    ("Pricing",             [("pricing",         "/api/analytics/pricing?date_from=2026-04-16&date_to=2026-05-14")]),
    ("Data Quality",        [("dq",              "/api/analytics/data-quality?date_from=2026-04-16&date_to=2026-05-14")]),
    ("Exports (Sales)",     [("orders-export",   "/api/exports/orders?date_from=2026-04-16&date_to=2026-05-14&limit=500")]),
    ("CEO Report",          [("ceo-report",      "/api/analytics/ceo-report?date_from=2026-04-16&date_to=2026-05-14")]),
]


def login():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PW}, timeout=30)
    r.raise_for_status()
    d = r.json()
    return d.get("access_token") or d.get("token") or d.get("session_token")


def hit(token, path, timeout=120):
    h = {"Authorization": f"Bearer {token}"}
    t0 = time.perf_counter()
    try:
        r = requests.get(f"{BASE_URL}{path}", headers=h, timeout=timeout)
        ms = (time.perf_counter() - t0) * 1000
        return r.status_code, round(ms, 1), len(r.content)
    except Exception as e:
        ms = (time.perf_counter() - t0) * 1000
        return f"ERR:{str(e)[:40]}", round(ms, 1), 0


def main():
    token = login()
    print(f"\n{'=' * 90}\nFULL SELF-AUDIT — {BASE_URL}\n{'=' * 90}\n")
    results = []
    print(f"{'PAGE':<22s} {'ENDPOINT':<24s} {'COLD':>10s} {'WARM':>10s} {'STATUS':<6s}")
    print("-" * 90)
    for page, eps in PAGES:
        for label, path in eps:
            cold = hit(token, path)
            time.sleep(0.5)
            warm = hit(token, path)
            results.append({"page": page, "label": label, "cold": cold, "warm": warm, "path": path})
            warm_ms = warm[1] if isinstance(warm[1], (int, float)) else 99999
            status_icon = "✅" if warm_ms < 2000 else ("⚠️ " if warm_ms < 5000 else "❌")
            print(f"{page:<22s} {label:<24s} {cold[1]:>8.1f}ms {warm[1]:>8.1f}ms  {cold[0]} {warm[0]}  {status_icon}")
    print()
    with open("/tmp/full_audit.json", "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"Report → /tmp/full_audit.json\n")


if __name__ == "__main__":
    main()
